/**
 * Dashboard TV (Passo 12) — visão executiva do ano corrente, composta das fontes
 * já existentes: KPIs + fluxo mensal do `getContaAzulDashboard`, vendas
 * (faturado × a faturar), inadimplência, despesa por centro (CA) e receita por BU
 * (nossas tabelas). Server-only, por empresa. Cache 5 min.
 *
 * ⚠️ "Despesa por BU" fica fora até o Passo 11 (import mapear BU) — as despesas
 * importadas caem todas em "Geral". Receita por BU já funciona.
 */
import "server-only";

import { getContaAzulDashboard } from "@/lib/contaazul/dashboard";
import { swr } from "@/lib/financeiro/cache";
import { resumoCentrosCusto } from "@/lib/financeiro/centros-custo";
import { listarInadimplentes } from "@/lib/financeiro/inadimplentes";
import { resumoVendas } from "@/lib/financeiro/vendas";
import { createAdminClient } from "@/lib/supabase/admin";

export interface PainelKpis {
  receitaRecebida: number;
  aReceber: number;
  vencidoReceber: number; // inadimplência (R$)
  despesaPaga: number;
  aPagar: number;
  vencidoPagar: number;
  resultado: number;
  saldoPrevisto: number;
  vendasFaturado: number;
  vendasAFaturar: number;
}
export interface PainelBar {
  nome: string;
  valor: number;
}
export interface PainelFluxoMes {
  mes: string; // 'AAAA-MM'
  receita: number;
  despesa: number;
}
export interface PainelAlerta {
  tipo: "inadimplencia" | "a_pagar" | "a_faturar";
  texto: string;
  valor: number;
}
export interface PainelResumo {
  connected: boolean;
  ano: number;
  kpis: PainelKpis;
  inadimplentesClientes: number;
  fluxoMensal: PainelFluxoMes[];
  receitaPorBu: PainelBar[];
  despesaPorCentro: PainelBar[];
  topDevedores: PainelBar[];
  alertas: PainelAlerta[];
  atualizadoEm: string;
  erro?: string;
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Receita por BU no ano (nossas tabelas — `fin_receita_snapshot`, bem mapeada por BU). */
async function receitaPorBu(companyId: string, ano: number): Promise<PainelBar[]> {
  const admin = createAdminClient();
  const de = `${ano}-01-01`;
  const ate = `${ano}-12-31`;
  const { data: bus } = await admin
    .from("business_units")
    .select("id, nome")
    .eq("company_id", companyId);
  const nomeById = new Map((bus ?? []).map((b) => [b.id as string, b.nome as string]));

  const PAGE = 1000;
  const agg = new Map<string, number>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("fin_receita_snapshot")
      .select("valor, bu_id")
      .eq("company_id", companyId)
      .gte("data_vencimento", de)
      .lte("data_vencimento", ate)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const r of rows) {
      const nome = nomeById.get(r.bu_id as string) ?? "Sem BU";
      agg.set(nome, (agg.get(nome) ?? 0) + num(r.valor));
    }
    if (rows.length < PAGE) break;
  }
  return [...agg.entries()]
    .map(([nome, valor]) => ({ nome, valor }))
    .filter((b) => b.valor > 0)
    .sort((a, b) => b.valor - a.valor);
}

async function computePainel(companyId: string, ano: number): Promise<PainelResumo> {
  const atualizadoEm = new Date().toISOString();

  const [dash, vendas, centros, inad, receitaBu] = await Promise.all([
    getContaAzulDashboard(companyId, { range: "ano" }).catch(() => null),
    resumoVendas(companyId, { ano }).catch(() => null),
    resumoCentrosCusto(companyId, { ano }).catch(() => null),
    listarInadimplentes(companyId).catch(() => null),
    receitaPorBu(companyId, ano).catch(() => [] as PainelBar[]),
  ]);

  const k = dash?.kpis;
  const kpis: PainelKpis = {
    receitaRecebida: num(k?.receitaRecebida),
    aReceber: num(k?.receitaAberta),
    vencidoReceber: num(inad?.total ?? k?.receitaVencida),
    despesaPaga: num(k?.despesaPaga),
    aPagar: num(k?.despesaAberta),
    vencidoPagar: num(k?.despesaVencida),
    resultado: num(k?.resultado),
    saldoPrevisto: num(k?.saldoPrevisto),
    vendasFaturado: num(vendas?.totais.faturado),
    vendasAFaturar: num(vendas?.totais.aFaturar),
  };

  const fluxoMensal: PainelFluxoMes[] = (dash?.fluxo ?? []).map((p) => ({
    mes: p.month,
    receita: num(p.receita),
    despesa: num(p.despesa),
  }));

  const despesaPorCentro: PainelBar[] = (centros?.linhas ?? [])
    .map((l) => ({ nome: l.centro, valor: l.realizado }))
    .filter((b) => b.valor > 0)
    .slice(0, 8);

  const topDevedores: PainelBar[] = (inad?.clientes ?? [])
    .slice(0, 8)
    .map((c) => ({ nome: c.cliente, valor: c.total }));

  const alertas: PainelAlerta[] = [];
  if (kpis.vencidoReceber > 0) {
    const nCli = inad?.clientes.length ?? 0;
    alertas.push({
      tipo: "inadimplencia",
      texto: `${brl.format(kpis.vencidoReceber)} vencidos a receber${nCli ? ` · ${nCli} cliente(s)` : ""}`,
      valor: kpis.vencidoReceber,
    });
  }
  if (kpis.vencidoPagar > 0) {
    alertas.push({
      tipo: "a_pagar",
      texto: `${brl.format(kpis.vencidoPagar)} em contas a pagar vencidas`,
      valor: kpis.vencidoPagar,
    });
  }
  if (kpis.vendasAFaturar > 0) {
    alertas.push({
      tipo: "a_faturar",
      texto: `${brl.format(kpis.vendasAFaturar)} em vendas aprovadas a faturar (NF pendente)`,
      valor: kpis.vendasAFaturar,
    });
  }

  const connected = !!(dash?.connected || vendas?.connected || centros?.connected);

  return {
    connected,
    ano,
    kpis,
    inadimplentesClientes: inad?.clientes.length ?? 0,
    fluxoMensal,
    receitaPorBu: receitaBu,
    despesaPorCentro,
    topDevedores,
    alertas,
    atualizadoEm,
  };
}

/** SWR 5 min. As sub-fontes já são SWR → recompute é barato. Ver `./cache`. */
export async function getPainel(
  companyId: string,
  opts: { force?: boolean } = {},
): Promise<PainelResumo> {
  const ano = new Date().getUTCFullYear();
  return swr(`painel:${companyId}:${ano}`, 5 * 60_000, () => computePainel(companyId, ano), {
    force: opts.force,
    cacheIf: (d) => d.connected,
  });
}
