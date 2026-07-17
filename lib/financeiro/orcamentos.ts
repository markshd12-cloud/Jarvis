/**
 * Orçamento & Limite (Passo 9): metas por categoria × BU × competência
 * (`fin_orcamentos`), o comparativo Orçado × Previsto × Realizado × Limite lido
 * das `fin_parcelas`, e a SUGESTÃO de previsão — a média mensal do custo lançado
 * (`valor_previsto`) dos últimos N meses, pra pré-preencher a meta do próximo mês.
 *
 * Server-only, escopado por `companyId`. É INDEPENDENTE do cutover (Passo 11):
 * lê sempre das NOSSAS parcelas, que já cobrem o histórico (reconciliado no 11).
 * Não materializa `fin_alertas` — o estouro deriva na leitura; a persistência do
 * alerta é do Dashboard TV (Passo 12).
 */
import "server-only";

import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import type {
  FinOrcamento,
  OrcamentoLinha,
  OrcamentoSugestaoLinha,
} from "./types";

const COMPETENCIA_RE = /^\d{4}-\d{2}$/;

export const orcamentoInputSchema = z.object({
  categoria_id: z.string().uuid("categoria obrigatória"),
  bu_id: z.string().uuid().nullish(),
  competencia: z.string().regex(COMPETENCIA_RE, "competência inválida (AAAA-MM)"),
  valor_orcado: z.coerce.number().nonnegative(),
  valor_limite: z.coerce.number().nonnegative().nullish(),
});
type OrcamentoInput = z.infer<typeof orcamentoInputSchema>;

// ------------------------------- Helpers -----------------------------------

function firstDay(ym: string): string {
  return `${ym}-01`;
}
function lastDay(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return `${ym}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
function ymAddMonths(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
/** Chave (categoria, bu) — bu null vira '' pro Map. */
function key(catId: string, buId: string | null): string {
  return `${catId}|${buId ?? ""}`;
}
function splitKey(k: string): { categoria_id: string; bu_id: string | null } {
  const [categoria_id, buRaw] = k.split("|");
  return { categoria_id, bu_id: buRaw || null };
}

// Linha (mínima) de fin_parcelas + categoria da despesa, como o PostgREST devolve.
type ParcelaJoin = {
  valor_previsto: unknown;
  valor_realizado: unknown;
  bu_id: string | null;
  status: string;
  data_competencia: string;
  fin_despesas: { categoria_id?: string | null } | null;
};

/** SELECT base: parcelas vivas (não cancelada) da despesa viva, na faixa de competência. */
async function fetchParcelas(
  companyId: string,
  deComp: string,
  ateComp: string,
): Promise<ParcelaJoin[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("fin_parcelas")
    .select(
      "valor_previsto, valor_realizado, bu_id, status, data_competencia, fin_despesas!inner ( categoria_id, cancelada )",
    )
    .eq("company_id", companyId)
    .gte("data_competencia", firstDay(deComp))
    .lte("data_competencia", lastDay(ateComp))
    .neq("status", "cancelada")
    .eq("fin_despesas.cancelada", false);
  if (error) throw new Error(`orcamentos.fetchParcelas: ${error.message}`);
  return (data ?? []) as unknown as ParcelaJoin[];
}

// ------------------------------ CRUD metas ---------------------------------

export async function listOrcamentos(
  companyId: string,
  competencia: string,
): Promise<FinOrcamento[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("fin_orcamentos")
    .select("*")
    .eq("company_id", companyId)
    .eq("competencia", competencia);
  if (error) throw new Error(`listOrcamentos: ${error.message}`);
  return (data ?? []) as FinOrcamento[];
}

/**
 * Cria ou atualiza a meta de (categoria, bu, competência). Upsert manual (não
 * `.upsert`): o índice único usa `coalesce(bu_id, zero)`, expressão que o
 * onConflict do PostgREST não casa. Busca com `is null`/`eq` e decide.
 */
export async function saveOrcamento(
  companyId: string,
  input: OrcamentoInput,
): Promise<FinOrcamento> {
  const v = orcamentoInputSchema.parse(input);
  const admin = createAdminClient();
  const buId = v.bu_id ?? null;

  let q = admin
    .from("fin_orcamentos")
    .select("id")
    .eq("company_id", companyId)
    .eq("categoria_id", v.categoria_id)
    .eq("competencia", v.competencia);
  q = buId === null ? q.is("bu_id", null) : q.eq("bu_id", buId);
  const { data: existing, error: e0 } = await q.maybeSingle();
  if (e0) throw new Error(`saveOrcamento(busca): ${e0.message}`);

  const payload = {
    valor_orcado: v.valor_orcado,
    valor_limite: v.valor_limite ?? null,
  };

  if (existing) {
    const { data, error } = await admin
      .from("fin_orcamentos")
      .update(payload)
      .eq("company_id", companyId)
      .eq("id", (existing as { id: string }).id)
      .select("*")
      .single();
    if (error) throw new Error(`saveOrcamento(update): ${error.message}`);
    return data as FinOrcamento;
  }

  const { data, error } = await admin
    .from("fin_orcamentos")
    .insert({
      company_id: companyId,
      categoria_id: v.categoria_id,
      bu_id: buId,
      competencia: v.competencia,
      ...payload,
    })
    .select("*")
    .single();
  if (error) throw new Error(`saveOrcamento(insert): ${error.message}`);
  return data as FinOrcamento;
}

export async function deleteOrcamento(
  companyId: string,
  id: string,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("fin_orcamentos")
    .delete()
    .eq("company_id", companyId)
    .eq("id", id);
  if (error) throw new Error(`deleteOrcamento: ${error.message}`);
}

// --------------------------- Comparativo -----------------------------------

/**
 * Orçado × Previsto × Realizado × Limite por (categoria, bu) na competência.
 * União das chaves com meta e/ou com lançamento. Flags derivados na leitura.
 */
export async function getOrcamentoComparativo(
  companyId: string,
  competencia: string,
): Promise<OrcamentoLinha[]> {
  if (!COMPETENCIA_RE.test(competencia))
    throw new Error("competência inválida (AAAA-MM)");

  const [orcs, parcelas] = await Promise.all([
    listOrcamentos(companyId, competencia),
    fetchParcelas(companyId, competencia, competencia),
  ]);

  const linhas = new Map<string, OrcamentoLinha>();
  const ensure = (catId: string, buId: string | null): OrcamentoLinha => {
    const k = key(catId, buId);
    let l = linhas.get(k);
    if (!l) {
      l = {
        id: null,
        categoria_id: catId,
        bu_id: buId,
        competencia,
        orcado: 0,
        limite: null,
        previsto: 0,
        realizado: 0,
        previstoExcede: false,
        limiteEstourado: false,
      };
      linhas.set(k, l);
    }
    return l;
  };

  for (const o of orcs) {
    const l = ensure(o.categoria_id, o.bu_id);
    l.id = o.id;
    l.orcado = num(o.valor_orcado);
    l.limite = o.valor_limite == null ? null : num(o.valor_limite);
  }

  for (const p of parcelas) {
    const catId = p.fin_despesas?.categoria_id ?? null;
    if (!catId) continue;
    const l = ensure(catId, p.bu_id ?? null);
    l.previsto += num(p.valor_previsto);
    if (p.status === "paga") l.realizado += num(p.valor_realizado);
  }

  for (const l of linhas.values()) {
    l.previstoExcede = l.orcado > 0 && l.previsto > l.orcado;
    l.limiteEstourado = l.limite != null && l.realizado > l.limite;
  }

  return [...linhas.values()];
}

// ---------------------------- Sugestão / previsão --------------------------

/**
 * Sugestão de previsão pro próximo mês: para cada (categoria, bu), a MÉDIA
 * mensal do custo lançado (`valor_previsto`) nos últimos `meses` meses ANTES da
 * competência pedida. Divide pela janela cheia (`meses`), não pelos meses ativos
 * — média conservadora de "quanto essa linha custa por mês". `mesesComDado`
 * acompanha como sinal de confiança. Base = previsto (não realizado): o custo
 * incorrido prevê melhor que o pagamento, imune ao atraso de baixa.
 */
export async function sugerirOrcamento(
  companyId: string,
  competencia: string,
  meses = 3,
): Promise<{
  meses: number;
  competenciasBase: string[];
  linhas: OrcamentoSugestaoLinha[];
}> {
  if (!COMPETENCIA_RE.test(competencia))
    throw new Error("competência inválida (AAAA-MM)");
  const n = Math.min(Math.max(1, Math.trunc(meses)), 12);
  const deComp = ymAddMonths(competencia, -n);
  const ateComp = ymAddMonths(competencia, -1);

  const parcelas = await fetchParcelas(companyId, deComp, ateComp);

  // key → (ym → soma previsto no mês)
  const porKey = new Map<string, Map<string, number>>();
  for (const p of parcelas) {
    const catId = p.fin_despesas?.categoria_id ?? null;
    if (!catId) continue;
    const ym = String(p.data_competencia).slice(0, 7);
    const k = key(catId, p.bu_id ?? null);
    const porMes = porKey.get(k) ?? new Map<string, number>();
    porMes.set(ym, (porMes.get(ym) ?? 0) + num(p.valor_previsto));
    porKey.set(k, porMes);
  }

  const competenciasBase = Array.from({ length: n }, (_, i) =>
    ymAddMonths(competencia, -(i + 1)),
  ).reverse();

  const linhas: OrcamentoSugestaoLinha[] = [];
  for (const [k, porMes] of porKey) {
    const { categoria_id, bu_id } = splitKey(k);
    const total = [...porMes.values()].reduce((a, b) => a + b, 0);
    linhas.push({
      categoria_id,
      bu_id,
      sugerido: Math.round((total / n) * 100) / 100,
      mesesComDado: porMes.size,
    });
  }

  return { meses: n, competenciasBase, linhas };
}
