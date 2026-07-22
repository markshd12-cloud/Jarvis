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
  /** Estouros de orçamento (previsto > orçado) na competência atual. Lista p/ o card. */
  alertasOrcamento: OrcamentoEstouro[];
  /** false = nenhum orçamento cadastrado → o card mostra estado-guia. */
  orcamentosDefinidos: boolean;
  /** Série anual por BU (receita/despesa mensal + fixa/variável) — p/ gráficos que mesclam BUs. */
  porBu: BuSerie[];
  atualizadoEm: string;
  erro?: string;
}

/** Estouro de orçamento: categoria/BU onde o PREVISTO passou do ORÇADO no mês. */
export interface OrcamentoEstouro {
  categoria: string;
  bu: string;
  orcado: number;
  previsto: number;
  excedente: number;
}
export interface BuMes {
  mes: string; // 'AAAA-MM'
  receita: number;
  despesa: number;
}
/** Série anual de uma BU: receita/despesa por mês + total fixa/variável no ano. */
export interface BuSerie {
  bu: string;
  buId: string | null;
  meses: BuMes[];
  fixa: number;
  variavel: number;
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

function ultimoDia(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return `${ym}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
function spMonth(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()).slice(0, 7);
}

interface ParcelaRow {
  valor_previsto: unknown;
  valor_realizado: unknown;
  status: string;
  bu_id: string | null;
  data_competencia: string;
  fin_despesas: unknown;
}
function despFrom(r: ParcelaRow): { categoria_id?: string | null; recorrencia_id?: string | null } | null {
  const d = r.fin_despesas;
  return (Array.isArray(d) ? d[0] : d) as { categoria_id?: string | null; recorrencia_id?: string | null } | null;
}

/**
 * Série anual por BU: receita (fin_receita_snapshot) e despesa (fin_parcelas) por
 * mês, + total de despesa FIXA (veio de recorrência → `fin_despesas.recorrencia_id`)
 * vs VARIÁVEL. ⚠️ Hoje a despesa está toda em "Geral" (Passo 11 pendente) e nada
 * veio de recorrência (tudo `ca_import`) → fixa=0. A estrutura acende sozinha.
 */
async function serieBuAnual(companyId: string, ano: number): Promise<BuSerie[]> {
  const admin = createAdminClient();
  const de = `${ano}-01-01`;
  const ate = `${ano}-12-31`;
  const meses = Array.from({ length: 12 }, (_, i) => `${ano}-${String(i + 1).padStart(2, "0")}`);
  const PAGE = 1000;

  const { data: bus } = await admin
    .from("business_units")
    .select("id, nome")
    .eq("company_id", companyId);
  const nomeById = new Map((bus ?? []).map((b) => [b.id as string, b.nome as string]));

  const receita = new Map<string, Map<string, number>>();
  const despesa = new Map<string, Map<string, number>>();
  const fixa = new Map<string, number>();
  const variavel = new Map<string, number>();
  const bump = (m: Map<string, Map<string, number>>, bu: string, ym: string, v: number) => {
    let inner = m.get(bu);
    if (!inner) m.set(bu, (inner = new Map()));
    inner.set(ym, (inner.get(ym) ?? 0) + v);
  };

  // Receita por BU × mês (data_vencimento).
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("fin_receita_snapshot")
      .select("valor, bu_id, data_vencimento")
      .eq("company_id", companyId)
      .gte("data_vencimento", de)
      .lte("data_vencimento", ate)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const r of rows) {
      const ym = (r.data_vencimento as string | null)?.slice(0, 7);
      if (ym) bump(receita, (r.bu_id as string) ?? "__none__", ym, num(r.valor));
    }
    if (rows.length < PAGE) break;
  }

  // Despesa por BU × mês (data_competencia) + fixa/variável (recorrencia_id).
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("fin_parcelas")
      .select(
        "valor_previsto, valor_realizado, status, bu_id, data_competencia, fin_despesas!inner ( categoria_id, recorrencia_id, cancelada )",
      )
      .eq("company_id", companyId)
      .gte("data_competencia", de)
      .lte("data_competencia", ate)
      .neq("status", "cancelada")
      .eq("fin_despesas.cancelada", false)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as ParcelaRow[];
    for (const r of rows) {
      const bu = r.bu_id ?? "__none__";
      const ym = r.data_competencia?.slice(0, 7);
      const val = r.status === "paga" ? num(r.valor_realizado ?? r.valor_previsto) : num(r.valor_previsto);
      if (ym) bump(despesa, bu, ym, val);
      if (despFrom(r)?.recorrencia_id) fixa.set(bu, (fixa.get(bu) ?? 0) + val);
      else variavel.set(bu, (variavel.get(bu) ?? 0) + val);
    }
    if (rows.length < PAGE) break;
  }

  const buIds = new Set<string>([...receita.keys(), ...despesa.keys()]);
  const series: BuSerie[] = [...buIds].map((buId) => {
    const r = receita.get(buId) ?? new Map();
    const d = despesa.get(buId) ?? new Map();
    return {
      bu: buId === "__none__" ? "Sem BU" : (nomeById.get(buId) ?? "Sem BU"),
      buId: buId === "__none__" ? null : buId,
      meses: meses.map((ym) => ({ mes: ym, receita: r.get(ym) ?? 0, despesa: d.get(ym) ?? 0 })),
      fixa: fixa.get(buId) ?? 0,
      variavel: variavel.get(buId) ?? 0,
    };
  });
  series.sort((a, b) => {
    const tot = (s: BuSerie) => s.meses.reduce((x, m) => x + m.receita + m.despesa, 0);
    return tot(b) - tot(a);
  });
  return series;
}

/**
 * Estouros de orçamento na competência atual: categorias/BU onde o PREVISTO das
 * parcelas passou do ORÇADO (`fin_orcamentos`). Vazio (e `definidos=false`) quando
 * não há orçamento cadastrado — o card mostra estado-guia.
 */
async function alertasOrcamentoDo(
  companyId: string,
  competencia: string,
): Promise<{ alertas: OrcamentoEstouro[]; definidos: boolean }> {
  const admin = createAdminClient();
  const { data: orcs } = await admin
    .from("fin_orcamentos")
    .select("categoria_id, bu_id, valor_orcado")
    .eq("company_id", companyId)
    .eq("competencia", competencia);
  const orcList = (orcs ?? []) as { categoria_id: string; bu_id: string | null; valor_orcado: unknown }[];
  if (orcList.length === 0) return { alertas: [], definidos: false };

  const { data: parc } = await admin
    .from("fin_parcelas")
    .select("valor_previsto, bu_id, status, data_competencia, fin_despesas!inner ( categoria_id, cancelada )")
    .eq("company_id", companyId)
    .gte("data_competencia", `${competencia}-01`)
    .lte("data_competencia", ultimoDia(competencia))
    .neq("status", "cancelada")
    .eq("fin_despesas.cancelada", false);
  const previstoBy = new Map<string, number>();
  for (const p of (parc ?? []) as unknown as ParcelaRow[]) {
    const cat = despFrom(p)?.categoria_id;
    if (!cat) continue;
    const k = `${cat}|${p.bu_id ?? ""}`;
    previstoBy.set(k, (previstoBy.get(k) ?? 0) + num(p.valor_previsto));
  }

  const { data: cats } = await admin.from("fin_categorias").select("id, nome").eq("company_id", companyId);
  const catName = new Map((cats ?? []).map((c) => [c.id as string, c.nome as string]));
  const { data: bus } = await admin.from("business_units").select("id, nome").eq("company_id", companyId);
  const buName = new Map((bus ?? []).map((b) => [b.id as string, b.nome as string]));

  const alertas: OrcamentoEstouro[] = [];
  for (const o of orcList) {
    const previsto = previstoBy.get(`${o.categoria_id}|${o.bu_id ?? ""}`) ?? 0;
    const orcado = num(o.valor_orcado);
    if (previsto > orcado) {
      alertas.push({
        categoria: catName.get(o.categoria_id) ?? "—",
        bu: o.bu_id ? (buName.get(o.bu_id) ?? "—") : "Todas",
        orcado,
        previsto,
        excedente: previsto - orcado,
      });
    }
  }
  alertas.sort((a, b) => b.excedente - a.excedente);
  return { alertas, definidos: true };
}

async function computePainel(companyId: string, ano: number): Promise<PainelResumo> {
  const atualizadoEm = new Date().toISOString();

  const [dash, vendas, centros, inad, receitaBu, porBu, orcInfo] = await Promise.all([
    getContaAzulDashboard(companyId, { range: "ano" }).catch(() => null),
    resumoVendas(companyId, { ano }).catch(() => null),
    resumoCentrosCusto(companyId, { ano }).catch(() => null),
    listarInadimplentes(companyId).catch(() => null),
    receitaPorBu(companyId, ano).catch(() => [] as PainelBar[]),
    serieBuAnual(companyId, ano).catch(() => [] as BuSerie[]),
    alertasOrcamentoDo(companyId, spMonth()).catch(() => ({
      alertas: [] as OrcamentoEstouro[],
      definidos: false,
    })),
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
    alertasOrcamento: orcInfo.alertas,
    orcamentosDefinidos: orcInfo.definidos,
    porBu,
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
