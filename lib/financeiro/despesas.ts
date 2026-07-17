/**
 * Contas a Pagar (Passo 6): despesa in-house com parcelamento. Cada parcela tem
 * BU, método, valor, vencimento e competência próprios. Server-only, escopado por
 * `companyId`. Substitui o lançamento de despesas do Conta Azul.
 *
 * Atomicidade (tudo-ou-nada): valida `Σ parcelas = valor_total` ANTES de gravar;
 * insere a despesa, depois as parcelas num único statement; se as parcelas
 * falharem, apaga a despesa (compensating delete) — do ponto de vista do usuário,
 * nada sobra. Status `atrasada` é DERIVADO na leitura (venc < hoje e não paga),
 * não materializado — sem job.
 */
import "server-only";

import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import type { GrupoParcela, ParcelaRow, SituacaoParcela } from "./types";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data AAAA-MM-DD");

const parcelaInputSchema = z.object({
  bu_id: z.string().uuid("BU obrigatória"),
  valor_previsto: z.coerce.number().nonnegative(),
  data_competencia: dateSchema,
  data_vencimento: dateSchema,
  metodo_pagamento: z.string().trim().nullish(),
});

export const despesaInputSchema = z.object({
  descricao: z.string().trim().min(1, "descrição obrigatória"),
  observacao: z.string().trim().nullish(),
  categoria_id: z.string().uuid("categoria obrigatória"),
  centro_custo_id: z.string().uuid().nullish(),
  colaborador_id: z.string().uuid().nullish(),
  valor_total: z.coerce.number().nonnegative(),
  parcelas: z.array(parcelaInputSchema).min(1, "ao menos 1 parcela"),
});
export type DespesaInput = z.infer<typeof despesaInputSchema>;

const cents = (v: number) => Math.round(v * 100);
const hojeISO = () => new Date().toISOString().slice(0, 10);

export async function criarDespesa(
  companyId: string,
  input: DespesaInput,
): Promise<{ id: string }> {
  const v = despesaInputSchema.parse(input);

  // Validação dura: soma das parcelas (em centavos) tem que bater com o total.
  const soma = v.parcelas.reduce((s, p) => s + cents(p.valor_previsto), 0);
  if (soma !== cents(v.valor_total))
    throw new Error(
      `Soma das parcelas (R$ ${(soma / 100).toFixed(2)}) diferente do valor total (R$ ${v.valor_total.toFixed(2)}).`,
    );

  const admin = createAdminClient();
  const { data: desp, error: e1 } = await admin
    .from("fin_despesas")
    .insert({
      company_id: companyId,
      descricao: v.descricao,
      observacao: v.observacao ?? null,
      categoria_id: v.categoria_id,
      centro_custo_id: v.centro_custo_id ?? null,
      colaborador_id: v.colaborador_id ?? null,
      valor_total: v.valor_total,
      num_parcelas: v.parcelas.length,
    })
    .select("id")
    .single();
  if (e1) throw new Error(`criarDespesa: ${e1.message}`);

  const rows = v.parcelas.map((p, i) => ({
    company_id: companyId,
    despesa_id: desp.id as string,
    numero: i + 1,
    bu_id: p.bu_id,
    valor_previsto: p.valor_previsto,
    data_competencia: p.data_competencia,
    data_vencimento: p.data_vencimento,
    metodo_pagamento: p.metodo_pagamento || null,
    status: "a_pagar" as const,
  }));
  const { error: e2 } = await admin.from("fin_parcelas").insert(rows);
  if (e2) {
    // Compensating delete: a despesa não pode existir sem suas parcelas.
    await admin.from("fin_despesas").delete().eq("company_id", companyId).eq("id", desp.id);
    throw new Error(`criarDespesa (parcelas): ${e2.message}`);
  }
  return { id: desp.id as string };
}

/** Exclui a despesa inteira (parcelas caem por cascade). */
export async function excluirDespesa(companyId: string, id: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("fin_despesas")
    .delete()
    .eq("company_id", companyId)
    .eq("id", id);
  if (error) throw new Error(`excluirDespesa: ${error.message}`);
}

export interface DespesaDetalheParcela {
  id: string;
  numero: number;
  bu_id: string;
  valor_previsto: number;
  valor_realizado: number | null;
  data_competencia: string;
  data_vencimento: string;
  data_pagamento: string | null;
  status: string;
  metodo_pagamento: string | null;
}
export interface DespesaDetalhe {
  id: string;
  descricao: string;
  observacao: string | null;
  categoria_id: string;
  centro_custo_id: string | null;
  colaborador_id: string | null;
  valor_total: number;
  parcelas: DespesaDetalheParcela[];
}

/** Despesa + TODAS as parcelas (p/ o dialog de edição). */
export async function getDespesa(
  companyId: string,
  id: string,
): Promise<DespesaDetalhe | null> {
  const admin = createAdminClient();
  const { data: d, error: e1 } = await admin
    .from("fin_despesas")
    .select(
      "id, descricao, observacao, categoria_id, centro_custo_id, colaborador_id, valor_total",
    )
    .eq("company_id", companyId)
    .eq("id", id)
    .maybeSingle();
  if (e1) throw new Error(`getDespesa: ${e1.message}`);
  if (!d) return null;

  const { data: ps, error: e2 } = await admin
    .from("fin_parcelas")
    .select(
      "id, numero, bu_id, valor_previsto, valor_realizado, data_competencia, data_vencimento, data_pagamento, status, metodo_pagamento",
    )
    .eq("company_id", companyId)
    .eq("despesa_id", id)
    .order("numero", { ascending: true });
  if (e2) throw new Error(`getDespesa (parcelas): ${e2.message}`);

  return {
    id: d.id as string,
    descricao: d.descricao as string,
    observacao: (d.observacao as string | null) ?? null,
    categoria_id: d.categoria_id as string,
    centro_custo_id: (d.centro_custo_id as string | null) ?? null,
    colaborador_id: (d.colaborador_id as string | null) ?? null,
    valor_total: Number(d.valor_total),
    parcelas: (ps ?? []).map((p) => ({
      id: p.id as string,
      numero: p.numero as number,
      bu_id: p.bu_id as string,
      valor_previsto: Number(p.valor_previsto),
      valor_realizado: p.valor_realizado == null ? null : Number(p.valor_realizado),
      data_competencia: p.data_competencia as string,
      data_vencimento: p.data_vencimento as string,
      data_pagamento: (p.data_pagamento as string | null) ?? null,
      status: p.status as string,
      metodo_pagamento: (p.metodo_pagamento as string | null) ?? null,
    })),
  };
}

/**
 * Edita a despesa e SUBSTITUI o parcelamento (re-valida Σ = total). Preserva a
 * baixa das parcelas que casarem por `numero` (mesmo nº → herda pagamento). As
 * demais entram como `a_pagar`. Delete-then-insert (janela curta sem transação).
 */
export async function atualizarDespesa(
  companyId: string,
  id: string,
  input: DespesaInput,
): Promise<{ id: string }> {
  const v = despesaInputSchema.parse(input);
  const soma = v.parcelas.reduce((s, p) => s + cents(p.valor_previsto), 0);
  if (soma !== cents(v.valor_total))
    throw new Error(
      `Soma das parcelas (R$ ${(soma / 100).toFixed(2)}) diferente do valor total (R$ ${v.valor_total.toFixed(2)}).`,
    );

  const admin = createAdminClient();
  const atual = await getDespesa(companyId, id);
  if (!atual) throw new Error("atualizarDespesa: despesa não encontrada");
  const pagoPorNumero = new Map(
    atual.parcelas
      .filter((p) => p.data_pagamento)
      .map((p) => [p.numero, p] as const),
  );

  const { error: e1 } = await admin
    .from("fin_despesas")
    .update({
      descricao: v.descricao,
      observacao: v.observacao ?? null,
      categoria_id: v.categoria_id,
      centro_custo_id: v.centro_custo_id ?? null,
      colaborador_id: v.colaborador_id ?? null,
      valor_total: v.valor_total,
      num_parcelas: v.parcelas.length,
    })
    .eq("company_id", companyId)
    .eq("id", id);
  if (e1) throw new Error(`atualizarDespesa: ${e1.message}`);

  await admin.from("fin_parcelas").delete().eq("company_id", companyId).eq("despesa_id", id);
  const rows = v.parcelas.map((p, i) => {
    const pago = pagoPorNumero.get(i + 1);
    return {
      company_id: companyId,
      despesa_id: id,
      numero: i + 1,
      bu_id: p.bu_id,
      valor_previsto: p.valor_previsto,
      data_competencia: p.data_competencia,
      data_vencimento: p.data_vencimento,
      metodo_pagamento: p.metodo_pagamento || null,
      status: pago ? ("paga" as const) : ("a_pagar" as const),
      data_pagamento: pago?.data_pagamento ?? null,
      valor_realizado: pago?.valor_realizado ?? null,
    };
  });
  const { error: e2 } = await admin.from("fin_parcelas").insert(rows);
  if (e2) throw new Error(`atualizarDespesa (parcelas): ${e2.message}`);
  return { id };
}

/** Baixa: marca a parcela como paga (default valor = previsto, data = hoje). */
export async function baixarParcela(
  companyId: string,
  id: string,
  opts: { valor_realizado?: number; data_pagamento?: string } = {},
): Promise<void> {
  const admin = createAdminClient();
  const { data: p, error: e0 } = await admin
    .from("fin_parcelas")
    .select("valor_previsto")
    .eq("company_id", companyId)
    .eq("id", id)
    .single();
  if (e0) throw new Error(`baixarParcela: ${e0.message}`);
  const { error } = await admin
    .from("fin_parcelas")
    .update({
      valor_realizado: opts.valor_realizado ?? Number(p.valor_previsto),
      data_pagamento: opts.data_pagamento ?? hojeISO(),
      status: "paga",
    })
    .eq("company_id", companyId)
    .eq("id", id);
  if (error) throw new Error(`baixarParcela: ${error.message}`);
}

/** Desfaz a baixa: volta a parcela para a_pagar (limpa realizado e pagamento). */
export async function desfazerBaixa(companyId: string, id: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("fin_parcelas")
    .update({ valor_realizado: null, data_pagamento: null, status: "a_pagar" })
    .eq("company_id", companyId)
    .eq("id", id);
  if (error) throw new Error(`desfazerBaixa: ${error.message}`);
}

export interface FiltrosParcela {
  grupo?: GrupoParcela;
  bu_id?: string;
  categoria_id?: string;
  centro_custo_id?: string;
  busca?: string;
  de?: string;
  ate?: string;
}

const one = <T>(v: T | T[] | null): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : v;

/** Lista as parcelas (linhas de contas a pagar) com o contexto da despesa. */
export async function listParcelas(
  companyId: string,
  filtros: FiltrosParcela = {},
): Promise<ParcelaRow[]> {
  const admin = createAdminClient();
  let q = admin
    .from("fin_parcelas")
    .select(
      `id, numero, valor_previsto, valor_realizado, data_competencia, data_vencimento,
       data_pagamento, status, metodo_pagamento, bu_id,
       business_units ( nome ),
       fin_despesas!inner ( id, descricao, num_parcelas, categoria_id, centro_custo_id,
         cancelada, fin_categorias ( nome ), fin_centros_custo ( nome ) )`,
    )
    .eq("company_id", companyId)
    .eq("fin_despesas.cancelada", false)
    .neq("status", "cancelada");

  const hoje = hojeISO();
  if (filtros.grupo === "pagas") q = q.not("data_pagamento", "is", null);
  else if (filtros.grupo === "vencida")
    q = q.is("data_pagamento", null).lt("data_vencimento", hoje);
  else if (filtros.grupo === "a_vencer")
    q = q.is("data_pagamento", null).gte("data_vencimento", hoje);

  if (filtros.bu_id) q = q.eq("bu_id", filtros.bu_id);
  if (filtros.categoria_id) q = q.eq("fin_despesas.categoria_id", filtros.categoria_id);
  if (filtros.centro_custo_id)
    q = q.eq("fin_despesas.centro_custo_id", filtros.centro_custo_id);
  if (filtros.busca) q = q.ilike("fin_despesas.descricao", `%${filtros.busca}%`);
  if (filtros.de) q = q.gte("data_vencimento", filtros.de);
  if (filtros.ate) q = q.lte("data_vencimento", filtros.ate);

  const { data, error } = await q.order("data_vencimento", { ascending: true });
  if (error) throw new Error(`listParcelas: ${error.message}`);

  return (data ?? []).map((r): ParcelaRow => {
    const bu = one<{ nome: string }>(r.business_units as never);
    const desp = one<{
      id: string;
      descricao: string;
      num_parcelas: number;
      fin_categorias: unknown;
      fin_centros_custo: unknown;
    }>(r.fin_despesas as never)!;
    const situacao: SituacaoParcela = r.data_pagamento
      ? "paga"
      : (r.data_vencimento as string) < hoje
        ? "vencida"
        : "a_vencer";
    return {
      id: r.id as string,
      despesa_id: desp.id,
      numero: r.numero as number,
      num_parcelas: desp.num_parcelas,
      descricao: desp.descricao,
      categoria_nome: one<{ nome: string }>(desp.fin_categorias as never)?.nome ?? null,
      centro_nome: one<{ nome: string }>(desp.fin_centros_custo as never)?.nome ?? null,
      bu_id: r.bu_id as string,
      bu_nome: bu?.nome ?? null,
      valor_previsto: Number(r.valor_previsto),
      valor_realizado: r.valor_realizado == null ? null : Number(r.valor_realizado),
      data_competencia: r.data_competencia as string,
      data_vencimento: r.data_vencimento as string,
      data_pagamento: (r.data_pagamento as string | null) ?? null,
      status: r.status as ParcelaRow["status"],
      metodo_pagamento: (r.metodo_pagamento as string | null) ?? null,
      situacao,
    };
  });
}

// --------------------------- Trava anti-duplicata --------------------------- //

export interface DuplicataCandidata {
  id: string;
  descricao: string;
  fonte: string; // 'manual' | 'ca_import'
  valor_total: number;
  data_vencimento: string;
  ca_evento_id: string | null;
}

const duplicataSchema = z.object({
  categoria_id: z.string().uuid("categoria obrigatória"),
  valor_total: z.coerce.number().nonnegative(),
  data_vencimento: dateSchema,
});

/**
 * Candidatos a DUPLICATA de uma nova despesa manual: mesma categoria, mesmo
 * valor (±1 centavo) e alguma parcela vencendo em ±3 dias. Não bloqueia nada — a
 * UI avisa antes de criar, pra não recriar à mão o que já veio do import do CA
 * (que é a defesa dura contra double-count no DRE cortado). Best-effort.
 */
export async function checarDuplicatas(
  companyId: string,
  input: { categoria_id: string; valor_total: number; data_vencimento: string },
): Promise<DuplicataCandidata[]> {
  const v = duplicataSchema.parse(input);
  const base = new Date(`${v.data_vencimento}T00:00:00Z`).getTime();
  const de = new Date(base - 3 * 864e5).toISOString().slice(0, 10);
  const ate = new Date(base + 3 * 864e5).toISOString().slice(0, 10);
  const tol = 0.01;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("fin_despesas")
    .select(
      "id, descricao, fonte, valor_total, ca_evento_id, fin_parcelas!inner ( data_vencimento )",
    )
    .eq("company_id", companyId)
    .eq("categoria_id", v.categoria_id)
    .eq("cancelada", false)
    .gte("valor_total", v.valor_total - tol)
    .lte("valor_total", v.valor_total + tol)
    .gte("fin_parcelas.data_vencimento", de)
    .lte("fin_parcelas.data_vencimento", ate);
  if (error) throw new Error(`checarDuplicatas: ${error.message}`);

  const out: DuplicataCandidata[] = [];
  for (const r of data ?? []) {
    const parcelas = (r.fin_parcelas ?? []) as { data_vencimento: string }[];
    out.push({
      id: r.id as string,
      descricao: r.descricao as string,
      fonte: (r.fonte as string | null) ?? "manual",
      valor_total: Number(r.valor_total),
      data_vencimento: parcelas[0]?.data_vencimento ?? v.data_vencimento,
      ca_evento_id: (r.ca_evento_id as string | null) ?? null,
    });
  }
  return out;
}
