/**
 * Fluxo de Caixa (Passo 13) — REGIME DE CAIXA (data de pagamento/recebimento),
 * não competência. Responde "quanto entra e sai, e qual o saldo", que o DRE (por
 * competência) não dá. Server-only, escopado por `companyId`. INDEPENDENTE do
 * cutover: lê sempre das NOSSAS tabelas.
 *
 * - Entradas: `fin_receita_snapshot` (Passo 10). Realizado = recebido, na data de
 *   pagamento; Previsto = a receber, na data de vencimento.
 * - Saídas REALIZADO: `fin_baixas` (migration 0038), na data de CADA baixa — não
 *   `fin_parcelas.data_pagamento`. Ver a nota grande abaixo: é o ajuste de
 *   2026-08-19.
 * - Saídas PREVISTO: `fin_parcelas` — o saldo ainda em aberto (previsto − Σ
 *   baixas − desconto) de quem não está "paga", na data de VENCIMENTO.
 *   Cancelada nunca entra.
 *
 * Sem conciliação bancária (fora de escopo do PRD): o acumulado parte de 0 — é o
 * saldo do FLUXO no período, não o saldo bancário absoluto.
 *
 * ## Por que ler `fin_baixas`, e não `fin_parcelas.data_pagamento`/`valor_realizado`
 *
 * Antes deste ajuste, a saída realizada saía de UMA data por parcela
 * (`data_pagamento`, ou `data_vencimento` quando `status='parcial'`). Isso é
 * exatamente o que a migration 0038 existe para resolver — do próprio comentário
 * dela: *"a parcela tem UM `data_pagamento`. Se as compras acontecem em 05/08,
 * 20/08 e 03/09, uma data só obriga a mentir sobre duas — e quebra o regime
 * Visão de Caixa, que agrupa por quando o dinheiro se move. Com data por baixa,
 * cada compra cai no mês certo sozinha."* E para `status='parcial'` (sem baixa
 * nenhuma "fechando" a parcela), `data_pagamento` fica `null` — então o código
 * antigo caía no bucket do VENCIMENTO, que é data de PLANO, não de caixa. Uma
 * conta com vencimento em agosto mas paga em julho aparecia como saída de
 * agosto; o dinheiro, de fato, já tinha saído em julho.
 *
 * A migration 0038 já fez a migração retroativa (uma baixa por parcela paga
 * antes dela existir) exatamente para que `fin_baixas` pudesse ser a ÚNICA fonte
 * do realizado, sem precisar de dois caminhos que divergem — e é isso que este
 * arquivo passa a fazer. Conferido em 2026-08-19: soma de `fin_baixas.valor` =
 * soma de `fin_parcelas.valor_realizado`, ao centavo, nas 3.254 parcelas da
 * empresa — não há paga/parcial sem baixa correspondente.
 */
import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { expandirPorBu, listRateios } from "./rateio";
import { mesCorrente } from "./competencia";

const cents = (v: number) => Math.round(v * 100);

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
  totais: {
    entrada: number;
    saida: number;
    liquido: number;
    /** Quebra previsto × realizado dos totais — a UI usa para as colunas do modo "ambos". */
    entradaPrev: number;
    entradaReal: number;
    saidaPrev: number;
    saidaReal: number;
  };
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

/** Parcelas em aberto (previsto = saldo ainda não baixado) na janela de vencimento. */
interface ParcelaPrevRow {
  id: string;
  valor_previsto: unknown;
  valor_realizado: unknown;
  desconto: unknown;
  status: string;
  data_vencimento: string;
  bu_id: string | null;
}
/** Cada baixa é o dinheiro saindo de fato — uma linha por pagamento real. */
interface BaixaRow {
  id: string;
  parcela_id: string;
  data: string;
  valor: unknown;
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
 * Pagina uma query do PostgREST em blocos de 1000 (o teto padrão do servidor),
 * com `.order()` obrigatório: sem ordem explícita, o Postgres não garante a
 * MESMA ordem entre duas chamadas de `.range()` — e páginas sucessivas podem
 * pular ou repetir linhas. Ver `listParcelas` (mesmo padrão).
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
        : mesCorrente();
    de = `${ym}-01`;
    ate = lastDayOfMonth(ym);
  } else {
    const ano = opts.ano && opts.ano > 2000 ? opts.ano : new Date().getUTCFullYear();
    de = `${ano}-01-01`;
    ate = `${ano}-12-31`;
  }

  const admin = createAdminClient();

  const [parcRows, baixaRows, recRows] = await Promise.all([
    // Previsto de saída: só quem ainda deve algo (não paga, não cancelada),
    // pela data em que o compromisso VENCE.
    pageAll<ParcelaPrevRow>((from, to) => {
      const q = admin
        .from("fin_parcelas")
        .select("id, valor_previsto, valor_realizado, desconto, status, data_vencimento, bu_id")
        .eq("company_id", companyId)
        .not("status", "in", "(cancelada,paga)")
        .gte("data_vencimento", de)
        .lte("data_vencimento", ate)
        .order("data_vencimento", { ascending: true })
        .order("id", { ascending: true });
      return q.range(from, to);
    }, "parcelas-previsto"),
    // Realizado de saída: cada baixa, na data em que o dinheiro de fato saiu.
    pageAll<BaixaRow>((from, to) => {
      const q = admin
        .from("fin_baixas")
        .select("id, parcela_id, data, valor")
        .eq("company_id", companyId)
        .gte("data", de)
        .lte("data", ate)
        .order("data", { ascending: true })
        .order("id", { ascending: true });
      return q.range(from, to);
    }, "baixas"),
    pageAll<ReceitaRow>((from, to) => {
      let q = admin
        .from("fin_receita_snapshot")
        .select("valor, recebido, data_vencimento, data_pagamento, bu_id, sincronizado_em")
        .eq("company_id", companyId)
        .or(
          `and(data_vencimento.gte.${de},data_vencimento.lte.${ate}),and(data_pagamento.gte.${de},data_pagamento.lte.${ate})`,
        )
        .order("data_vencimento", { ascending: true, nullsFirst: true })
        .order("data_pagamento", { ascending: true, nullsFirst: true });
      if (buId) q = q.eq("bu_id", buId);
      return q.range(from, to);
    }, "receita"),
  ]);

  const buckets = bucketsVazios(modo, de, ate);
  const porChave = new Map(buckets.map((b) => [b.chave, b]));
  const dentro = (iso: string) => iso >= de && iso <= ate;

  // --- rateio por BU, só quando há filtro --------------------------------- //
  // A BU de uma baixa é a da PARCELA que ela consome (fase 1 do rateio: a baixa
  // HERDA o rateio do envelope — ver docs/financeiro-baixas-parciais.md). As
  // baixas podem apontar para parcelas fora da janela de vencimento (pagamento
  // antecipado, ou parcela com vencimento em outro mês), então o bu_id delas é
  // buscado à parte, não reaproveitado de `parcRows`.
  let buPorParcela = new Map<string, string | null>();
  let rateiosPrev: Map<string, { bu_id: string; percentual: number }[]> | null = null;
  let rateiosBaixa: Map<string, { bu_id: string; percentual: number }[]> | null = null;
  if (buId) {
    const idsBaixa = [...new Set(baixaRows.map((b) => b.parcela_id))];
    const idsFaltantes = idsBaixa.filter((id) => !parcRows.some((p) => p.id === id));
    if (idsFaltantes.length) {
      const LOTE = 200;
      for (let i = 0; i < idsFaltantes.length; i += LOTE) {
        const { data, error } = await admin
          .from("fin_parcelas")
          .select("id, bu_id")
          .eq("company_id", companyId)
          .in("id", idsFaltantes.slice(i, i + LOTE));
        if (error) throw new Error(`getFluxoCaixa (bu-das-baixas): ${error.message}`);
        for (const r of data ?? []) buPorParcela.set(r.id as string, r.bu_id as string | null);
      }
    }
    for (const p of parcRows) buPorParcela.set(p.id, p.bu_id);

    rateiosPrev = await listRateios(companyId, parcRows.map((p) => p.id));
    rateiosBaixa = await listRateios(companyId, idsBaixa);
  }
  /** Fatia de um valor atribuível ao filtro de BU (proporcional ao rateio da parcela). */
  const fatiaBu = (
    parcelaId: string,
    parcelaBuId: string | null,
    valor: number,
    rateios: Map<string, { bu_id: string; percentual: number }[]> | null,
  ): number | null => {
    if (!buId) return valor;
    if (!parcelaBuId) return null;
    const fatia = expandirPorBu(cents(valor), parcelaBuId, rateios?.get(parcelaId)).find(
      (f) => f.bu_id === buId,
    );
    return fatia ? fatia.valorCents / 100 : null;
  };

  // --- Saída PREVISTO: saldo em aberto, por vencimento --------------------- //
  for (const p of parcRows) {
    if (!dentro(p.data_vencimento)) continue;
    const b = porChave.get(bucketKey(modo, p.data_vencimento));
    if (!b) continue;
    const restante =
      num(p.valor_previsto) - num(p.valor_realizado) - num(p.desconto);
    if (restante <= 0) continue;
    const v = fatiaBu(p.id, p.bu_id, restante, rateiosPrev);
    if (v !== null) b.saidaPrev += v;
  }

  // --- Saída REALIZADO: cada baixa, na sua própria data --------------------- //
  for (const bx of baixaRows) {
    if (!dentro(bx.data)) continue;
    const b = porChave.get(bucketKey(modo, bx.data));
    if (!b) continue;
    const parcelaBuId = buPorParcela.get(bx.parcela_id) ?? null;
    const v = fatiaBu(bx.parcela_id, parcelaBuId, num(bx.valor), rateiosBaixa);
    if (v !== null) b.saidaReal += v;
  }

  // --- Entradas (fin_receita_snapshot) -------------------------------------- //
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
  const totais = {
    entrada: 0,
    saida: 0,
    liquido: 0,
    entradaPrev: 0,
    entradaReal: 0,
    saidaPrev: 0,
    saidaReal: 0,
  };
  for (const b of buckets) {
    b.entrada = (usaPrev ? b.entradaPrev : 0) + (usaReal ? b.entradaReal : 0);
    b.saida = (usaPrev ? b.saidaPrev : 0) + (usaReal ? b.saidaReal : 0);
    b.liquido = b.entrada - b.saida;
    acc += b.liquido;
    b.acumulado = acc;
    totais.entrada += b.entrada;
    totais.saida += b.saida;
    totais.entradaPrev += b.entradaPrev;
    totais.entradaReal += b.entradaReal;
    totais.saidaPrev += b.saidaPrev;
    totais.saidaReal += b.saidaReal;
  }
  totais.liquido = totais.entrada - totais.saida;

  return { modo, incluir, buId, periodo: { de, ate }, buckets, totais, sincronizadoEm };
}
