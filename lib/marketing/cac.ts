/**
 * CAC — Custo de Aquisição por Cliente. Ver `docs/cac-plano.md`.
 *
 *   CAC = (custo de Marketing + custo de Comercial) ÷ nº de vendas do período
 *
 * Decisões implementadas (2026-07-21):
 *  1. **Conta Azul é a VERDADE do custo** (dinheiro real, sem dupla contagem com
 *     o Meta Ads, cuja fatura já entra como despesa no CA).
 *  2. Custo compartilhado é **rateado por receita da BU** (driver configurável).
 *  4. "Vendas" = **faturadas + a faturar** (`qtd` total do Conta Azul).
 *
 * ## Como o custo vira "por BU" sem depender do Passo 11
 * O nome do centro de custo vem da PRÓPRIA despesa no CA (`centros_de_custo[0].nome`)
 * e costuma embutir a unidade: "Unicive marketing", "cppem comercial", "cppem
 * marketing". `classificarCentro()` extrai **BU** e **tipo** (marketing/comercial)
 * do nome:
 *  - com BU no nome  → **custo DIRETO** daquela BU;
 *  - sem BU ("Marketing", "Comercial") → **compartilhado**, rateado pelo driver.
 * Isso funciona hoje, sem esperar categorias mapeadas nem `centro_custo_id`.
 *
 * ⚠️ Ainda NÃO há nº de vendas por BU (o CA não informa a BU da venda), então o
 * CAC por BU não sai em R$ — a ponte é `pctSobreReceita`. Ver decisão 3 na doc.
 *
 * Server-only, por empresa. Gate no chamador: `marketing` E `financeiro`.
 */
import "server-only";

import { swr } from "@/lib/financeiro/cache";
import { resumoCentrosCusto } from "@/lib/financeiro/centros-custo";
import { resumoVendas } from "@/lib/financeiro/vendas";
import { getMetaMetrics } from "@/lib/marketing/metrics";
import { createAdminClient } from "@/lib/supabase/admin";

/** Como distribuir o custo COMPARTILHADO entre as BUs. */
export type CacDriver = "receita" | "midia";

/** Tipo de custo que entra no CAC. */
export type CacTipo = "marketing" | "comercial";

/** Marca do Meta Ads → BU. "Everton" é marca pessoal, sem BU própria. */
const MARCA_PARA_BU: Record<string, string> = {
  "CPPEM Concursos": "CPPEM",
  Colégio: "Colégio",
  Unicive: "Unicive",
  Everton: "Geral",
};

/**
 * Extrai BU e tipo do NOME do centro de custo (ex.: "Unicive marketing").
 * `bu: null` = custo compartilhado (nome sem unidade). `tipo: null` = centro que
 * não entra no CAC (Pedagógico, Tecnologia, ...).
 */
export function classificarCentro(nome: string): { bu: string | null; tipo: CacTipo | null } {
  // Sem normalizacao NFD: os padroes ja aceitam a forma acentuada.
  const n = (nome ?? "").toLowerCase();

  const tipo: CacTipo | null = /marketing|mkt/.test(n)
    ? "marketing"
    : /comercial|vendas/.test(n)
      ? "comercial"
      : null;

  // "unicv" é como aparece em centros antigos do CA (UNICV CARUARU).
  const bu = /unicive|unicv/.test(n)
    ? "Unicive"
    : /col[eé]gio/.test(n)
      ? "Colégio"
      : /cppem|concursos/.test(n)
        ? "CPPEM"
        : null;

  return { bu, tipo };
}

export interface CacCentro {
  centro: string;
  bu: string | null;
  tipo: CacTipo;
  valor: number;
}

export interface CacBu {
  bu: string;
  receita: number;
  /** Participação no driver do rateio (0-1). */
  share: number;
  /** Custo cujo centro já identifica a BU no nome. */
  custoDireto: number;
  /** Parte do custo compartilhado que coube à BU. */
  custoRateado: number;
  custoTotal: number;
  /** Investimento de mídia da marca correspondente (informativo). */
  midia: number;
  /** Ponte enquanto não há vendas por BU: custo ÷ receita (%). */
  pctSobreReceita: number | null;
}

export interface CacMes {
  mes: string; // 'AAAA-MM'
  custo: number;
  vendas: number;
  cac: number | null;
}

export interface CacResumo {
  connected: boolean;
  ano: number;
  driver: CacDriver;
  // ---- Custo (fonte: Conta Azul) ----
  custoMarketing: number;
  custoComercial: number;
  custoTotal: number;
  /** Centros que entraram na conta (com BU quando o nome identifica). */
  centros: CacCentro[];
  centrosEncontrados: boolean;
  /** Quanto do custo já tem BU no nome vs. quanto é compartilhado. */
  custoDiretoTotal: number;
  custoCompartilhado: number;
  // ---- Mídia (composição; NÃO soma ao custo) ----
  midiaPorMarca: { marca: string; bu: string; valor: number }[];
  midiaTotal: number;
  // ---- Vendas (fonte: Conta Azul) ----
  vendas: number;
  vendasFaturadas: number;
  vendasAFaturar: number;
  // ---- Resultado ----
  cac: number | null;
  serie: CacMes[];
  // ---- Por BU ----
  receitaTotal: number;
  porBu: CacBu[];
  temCustoDireto: boolean;
  atualizadoEm: string;
  erro?: string;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Receita do ano por BU (nossas tabelas — bem mapeadas por categoria→BU). */
async function receitaPorBu(companyId: string, ano: number): Promise<Map<string, number>> {
  const admin = createAdminClient();
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
      .gte("data_vencimento", `${ano}-01-01`)
      .lte("data_vencimento", `${ano}-12-31`)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const r of rows) {
      const nome = nomeById.get(r.bu_id as string) ?? "Sem BU";
      agg.set(nome, (agg.get(nome) ?? 0) + num(r.valor));
    }
    if (rows.length < PAGE) break;
  }
  return agg;
}

async function computeCac(
  companyId: string,
  ano: number,
  driver: CacDriver,
): Promise<CacResumo> {
  const atualizadoEm = new Date().toISOString();

  const [centrosResumo, vendas, receitaBu, meta] = await Promise.all([
    resumoCentrosCusto(companyId, { ano }).catch(() => null),
    resumoVendas(companyId, { ano }).catch(() => null),
    receitaPorBu(companyId, ano).catch(() => new Map<string, number>()),
    getMetaMetrics({ since: `${ano}-01-01`, until: `${ano}-12-31` }).catch(() => null),
  ]);

  // ---- Custo: só centros de Marketing/Comercial, com BU extraída do nome ----
  const centros: CacCentro[] = [];
  for (const l of centrosResumo?.linhas ?? []) {
    const { bu, tipo } = classificarCentro(l.centro);
    if (!tipo) continue; // Pedagógico, Tecnologia... não entram no CAC
    const valor = num(l.realizado);
    if (valor === 0) continue;
    centros.push({ centro: l.centro, bu, tipo, valor });
  }
  centros.sort((a, b) => b.valor - a.valor);

  const custoMarketing = centros.filter((c) => c.tipo === "marketing").reduce((s, c) => s + c.valor, 0);
  const custoComercial = centros.filter((c) => c.tipo === "comercial").reduce((s, c) => s + c.valor, 0);
  const custoTotal = custoMarketing + custoComercial;

  const diretoPorBu = new Map<string, number>();
  let custoCompartilhado = 0;
  for (const c of centros) {
    if (c.bu) diretoPorBu.set(c.bu, (diretoPorBu.get(c.bu) ?? 0) + c.valor);
    else custoCompartilhado += c.valor;
  }
  const custoDiretoTotal = custoTotal - custoCompartilhado;

  // ---- Mídia por marca (composição + driver alternativo) ----
  const midiaPorMarca = (meta?.brands ?? [])
    .map((b) => ({
      marca: b.brand ?? "?",
      bu: MARCA_PARA_BU[b.brand ?? ""] ?? "Geral",
      valor: num(b.spend),
    }))
    .filter((m) => m.valor > 0)
    .sort((a, b) => b.valor - a.valor);
  const midiaTotal = midiaPorMarca.reduce((s, m) => s + m.valor, 0);

  // ---- Vendas: faturadas + a faturar (decisão 4) ----
  const vendasFaturadas = num(vendas?.totais.qtdFaturado);
  const vendasAFaturar = num(vendas?.totais.qtdAFaturar);
  const totalVendas = num(vendas?.totais.qtd);

  // ---- Série mensal: custo (centros do CAC) ÷ vendas do mês ----
  const custoMes = new Map<string, number>();
  for (const m of centrosResumo?.porMes ?? []) {
    if (!classificarCentro(m.centro).tipo) continue;
    custoMes.set(m.mes, (custoMes.get(m.mes) ?? 0) + num(m.realizado));
  }
  const vendasMes = new Map<string, number>();
  for (const v of vendas?.vendas ?? []) {
    const mes = (v.data ?? "").slice(0, 7);
    if (mes) vendasMes.set(mes, (vendasMes.get(mes) ?? 0) + 1);
  }
  const meses = [...new Set([...custoMes.keys(), ...vendasMes.keys()])].sort();
  const serie: CacMes[] = meses.map((mes) => {
    const custo = custoMes.get(mes) ?? 0;
    const qtd = vendasMes.get(mes) ?? 0;
    return { mes, custo, vendas: qtd, cac: qtd > 0 ? custo / qtd : null };
  });

  // ---- Por BU: direto (do nome do centro) + rateio do compartilhado ----
  const midiaPorBu = new Map<string, number>();
  for (const m of midiaPorMarca) midiaPorBu.set(m.bu, (midiaPorBu.get(m.bu) ?? 0) + m.valor);

  const nomes = new Set<string>([
    ...receitaBu.keys(),
    ...midiaPorBu.keys(),
    ...diretoPorBu.keys(),
  ]);
  const receitaTotal = [...receitaBu.values()].reduce((s, v) => s + v, 0);
  const baseDriver = driver === "midia" ? midiaTotal : receitaTotal;

  const porBu: CacBu[] = [...nomes]
    .map((bu) => {
      const receita = receitaBu.get(bu) ?? 0;
      const midia = midiaPorBu.get(bu) ?? 0;
      const peso = driver === "midia" ? midia : receita;
      const share = baseDriver > 0 ? peso / baseDriver : 0;
      const custoDireto = diretoPorBu.get(bu) ?? 0;
      const custoRateado = custoCompartilhado * share;
      const total = custoDireto + custoRateado;
      return {
        bu,
        receita,
        share,
        custoDireto,
        custoRateado,
        custoTotal: total,
        midia,
        pctSobreReceita: receita > 0 ? (total / receita) * 100 : null,
      };
    })
    .sort((a, b) => b.custoTotal - a.custoTotal);

  return {
    connected: !!(centrosResumo?.connected || vendas?.connected),
    ano,
    driver,
    custoMarketing,
    custoComercial,
    custoTotal,
    centros,
    centrosEncontrados: centros.length > 0,
    custoDiretoTotal,
    custoCompartilhado,
    midiaPorMarca,
    midiaTotal,
    vendas: totalVendas,
    vendasFaturadas,
    vendasAFaturar,
    cac: totalVendas > 0 ? custoTotal / totalVendas : null,
    serie,
    receitaTotal,
    porBu,
    temCustoDireto: custoDiretoTotal > 0,
    atualizadoEm,
  };
}

/** CAC do ano. Cache SWR 5 min (as sub-fontes já são cacheadas). */
export async function getCac(
  companyId: string,
  opts: { ano?: number; driver?: CacDriver; force?: boolean } = {},
): Promise<CacResumo> {
  const ano = opts.ano ?? new Date().getUTCFullYear();
  const driver = opts.driver ?? "receita";
  return swr(
    `cac:${companyId}:${ano}:${driver}`,
    5 * 60_000,
    () => computeCac(companyId, ano, driver),
    { force: opts.force, cacheIf: (d) => d.connected },
  );
}
