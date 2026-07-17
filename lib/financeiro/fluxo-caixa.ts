/**
 * Fluxo de Caixa (Passo 13) — REGIME DE CAIXA (data de pagamento/recebimento),
 * não competência. Responde "quanto entra e sai, e qual o saldo", que o DRE (por
 * competência) não dá. Server-only, escopado por `companyId`. INDEPENDENTE do
 * cutover: lê sempre das NOSSAS tabelas.
 *
 * - Entradas: `fin_receita_snapshot` (Passo 10). Realizado = recebido, na data de
 *   pagamento; Previsto = a receber, na data de vencimento.
 * - Saídas: `fin_parcelas`. Realizado = paga, na data de pagamento; Previsto =
 *   (prevista/a_pagar/atrasada), na data de vencimento. Cancelada nunca entra.
 *
 * Sem conciliação bancária (fora de escopo do PRD): o acumulado parte de 0 — é o
 * saldo do FLUXO no período, não o saldo bancário absoluto.
 */
import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export type FluxoModo = "mensal" | "diario";
export type FluxoIncluir = "ambos" | "previsto" | "realizado";

export interface FluxoBucket {
  chave: string; // 'AAAA-MM' (mensal) | 'AAAA-MM-DD' (diário)
  label: string;
  entradaPrev: number;
  entradaReal: number;
  saidaPrev: number;
  saidaReal: number;
  entrada: number; // conforme `incluir`
  saida: number; // conforme `incluir`
  liquido: number; // entrada − saída
  acumulado: number; // saldo corrente do fluxo (parte de 0)
}

export interface FluxoCaixaResult {
  modo: FluxoModo;
  incluir: FluxoIncluir;
  buId: string | null;
  periodo: { de: string; ate: string };
  buckets: FluxoBucket[];
  totais: { entrada: number; saida: number; liquido: number };
  sincronizadoEm: string | null; // frescor do snapshot de receita
}

const MESES_ABREV = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function lastDayOfMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return `${ym}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Gera os buckets vazios do período (12 meses do ano, ou os dias do mês). */
function bucketsVazios(modo: FluxoModo, de: string, ate: string): FluxoBucket[] {
  const novo = (chave: string, label: string): FluxoBucket => ({
    chave,
    label,
    entradaPrev: 0,
    entradaReal: 0,
    saidaPrev: 0,
    saidaReal: 0,
    entrada: 0,
    saida: 0,
    liquido: 0,
    acumulado: 0,
  });
  const out: FluxoBucket[] = [];
  if (modo === "mensal") {
    const ano = de.slice(0, 4);
    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, "0");
      out.push(novo(`${ano}-${mm}`, `${MESES_ABREV[m - 1]}/${ano}`));
    }
  } else {
    const ym = de.slice(0, 7);
    const ultimo = Number(lastDayOfMonth(ym).slice(8, 10));
    for (let d = 1; d <= ultimo; d++) {
      const dd = String(d).padStart(2, "0");
      out.push(novo(`${ym}-${dd}`, String(d)));
    }
  }
  return out;
}

const bucketKey = (modo: FluxoModo, isoDate: string): string =>
  modo === "mensal" ? isoDate.slice(0, 7) : isoDate.slice(0, 10);

interface ParcelaRow {
  valor_previsto: unknown;
  valor_realizado: unknown;
  status: string;
  data_vencimento: string;
  data_pagamento: string | null;
  bu_id: string | null;
}
interface ReceitaRow {
  valor: unknown;
  recebido: boolean;
  data_vencimento: string | null;
  data_pagamento: string | null;
  bu_id: string | null;
  sincronizado_em: string | null;
}

/**
 * Pagina uma query do PostgREST em blocos de 1000 (o teto padrão do servidor).
 * Sem isto, um ano de parcelas/receita seria SILENCIOSAMENTE truncado em 1000.
 */
async function pageAll<T>(
  build: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  label: string,
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(`getFluxoCaixa (${label}): ${error.message}`);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export async function getFluxoCaixa(
  companyId: string,
  opts: {
    modo?: FluxoModo;
    ano?: number; // modo mensal
    mes?: string; // modo diário ('AAAA-MM')
    buId?: string | null;
    incluir?: FluxoIncluir;
  } = {},
): Promise<FluxoCaixaResult> {
  const modo: FluxoModo = opts.modo === "diario" ? "diario" : "mensal";
  const incluir: FluxoIncluir =
    opts.incluir === "previsto" || opts.incluir === "realizado"
      ? opts.incluir
      : "ambos";
  const buId = opts.buId ?? null;

  let de: string;
  let ate: string;
  if (modo === "diario") {
    const ym =
      opts.mes && /^\d{4}-\d{2}$/.test(opts.mes)
        ? opts.mes
        : new Date().toISOString().slice(0, 7);
    de = `${ym}-01`;
    ate = lastDayOfMonth(ym);
  } else {
    const ano = opts.ano && opts.ano > 2000 ? opts.ano : new Date().getUTCFullYear();
    de = `${ano}-01-01`;
    ate = `${ano}-12-31`;
  }

  const admin = createAdminClient();

  // Sobre-busca por vencimento OU pagamento na janela; o regime é decidido em JS.
  const janelaOr = `and(data_vencimento.gte.${de},data_vencimento.lte.${ate}),and(data_pagamento.gte.${de},data_pagamento.lte.${ate})`;

  const [parcRows, recRows] = await Promise.all([
    pageAll<ParcelaRow>((from, to) => {
      let q = admin
        .from("fin_parcelas")
        .select("valor_previsto, valor_realizado, status, data_vencimento, data_pagamento, bu_id")
        .eq("company_id", companyId)
        .neq("status", "cancelada")
        .or(janelaOr);
      if (buId) q = q.eq("bu_id", buId);
      return q.range(from, to);
    }, "parcelas"),
    pageAll<ReceitaRow>((from, to) => {
      let q = admin
        .from("fin_receita_snapshot")
        .select("valor, recebido, data_vencimento, data_pagamento, bu_id, sincronizado_em")
        .eq("company_id", companyId)
        .or(janelaOr);
      if (buId) q = q.eq("bu_id", buId);
      return q.range(from, to);
    }, "receita"),
  ]);

  const buckets = bucketsVazios(modo, de, ate);
  const porChave = new Map(buckets.map((b) => [b.chave, b]));
  const dentro = (iso: string) => iso >= de && iso <= ate;

  // Saídas (fin_parcelas)
  for (const p of parcRows) {
    const paga = p.status === "paga";
    const iso = paga ? p.data_pagamento ?? p.data_vencimento : p.data_vencimento;
    if (!iso || !dentro(iso)) continue;
    const b = porChave.get(bucketKey(modo, iso));
    if (!b) continue;
    if (paga) b.saidaReal += num(p.valor_realizado ?? p.valor_previsto);
    else b.saidaPrev += num(p.valor_previsto);
  }

  // Entradas (fin_receita_snapshot)
  let sincronizadoEm: string | null = null;
  for (const r of recRows) {
    if (r.sincronizado_em && (!sincronizadoEm || r.sincronizado_em > sincronizadoEm))
      sincronizadoEm = r.sincronizado_em;
    const iso = r.recebido ? r.data_pagamento ?? r.data_vencimento : r.data_vencimento;
    if (!iso || !dentro(iso)) continue;
    const b = porChave.get(bucketKey(modo, iso));
    if (!b) continue;
    if (r.recebido) b.entradaReal += num(r.valor);
    else b.entradaPrev += num(r.valor);
  }

  // Consolida entrada/saída conforme filtro, líquido e acumulado corrente.
  const usaPrev = incluir !== "realizado";
  const usaReal = incluir !== "previsto";
  let acc = 0;
  const totais = { entrada: 0, saida: 0, liquido: 0 };
  for (const b of buckets) {
    b.entrada = (usaPrev ? b.entradaPrev : 0) + (usaReal ? b.entradaReal : 0);
    b.saida = (usaPrev ? b.saidaPrev : 0) + (usaReal ? b.saidaReal : 0);
    b.liquido = b.entrada - b.saida;
    acc += b.liquido;
    b.acumulado = acc;
    totais.entrada += b.entrada;
    totais.saida += b.saida;
  }
  totais.liquido = totais.entrada - totais.saida;

  return { modo, incluir, buId, periodo: { de, ate }, buckets, totais, sincronizadoEm };
}
