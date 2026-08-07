/**
 * Baixas parciais — "despesa-envelope" (migration 0038).
 *
 * Uma conta como "REPOSIÇÃO DE ESTOQUE — R$ 10.000" não é fatura: é um teto
 * consumido por compras pequenas. Cada pagamento real vira uma linha aqui, com
 * data, valor e descrição próprios, e a parcela passa a ter SALDO.
 *
 * O ENVELOPE É EMERGENTE: não há marcador de tipo na despesa. Qualquer conta
 * pode receber baixa parcial, e o envelope nasce no primeiro lançamento.
 *
 * Ver docs/financeiro-baixas-parciais.md. Server-only, escopado por empresa.
 */
import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { hojeSP } from "./competencia";

/**
 * Hoje no fuso da operação (o servidor é UTC). Em UTC, das 21h à meia-noite já
 * seria "amanhã" no Brasil — e a baixa cairia no dia errado.
 */
const hojeISO = () => hojeSP();

export interface FinBaixa {
  id: string;
  parcela_id: string;
  data: string;
  competencia: string;
  valor: number;
  descricao: string | null;
  metodo_pagamento: string | null;
  observacao: string | null;
  created_at: string;
}

/**
 * Centavos para somar sem erro de ponto flutuante.
 *
 * `0.1 + 0.2 !== 0.3` em float: somar 40 baixas de centavos acumularia
 * diferença suficiente para o saldo nunca zerar exatamente — e a parcela nunca
 * viraria "paga".
 */
const cents = (v: number | string | null | undefined): number =>
  Math.round(Number(v ?? 0) * 100);

/** Lista as baixas de uma parcela, da mais antiga para a mais nova. */
export async function listarBaixas(
  companyId: string,
  parcelaId: string,
): Promise<FinBaixa[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("fin_baixas")
    .select(
      "id, parcela_id, data, competencia, valor, descricao, metodo_pagamento, observacao, created_at",
    )
    .eq("company_id", companyId)
    .eq("parcela_id", parcelaId)
    .order("data", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listarBaixas: ${error.message}`);
  return (data ?? []).map((b) => ({ ...b, valor: Number(b.valor) })) as FinBaixa[];
}

/**
 * Baixas de VÁRIAS parcelas de uma vez, indexadas por `parcela_id`.
 *
 * Existe para a listagem de Contas a pagar não fazer uma consulta por linha
 * (N+1): com ~120 parcelas na tela seriam 120 idas ao banco.
 */
export async function baixasPorParcela(
  companyId: string,
  parcelaIds: string[],
): Promise<Map<string, FinBaixa[]>> {
  const out = new Map<string, FinBaixa[]>();
  if (parcelaIds.length === 0) return out;

  const admin = createAdminClient();
  const LOTE = 100; // `.in()` com muitos UUIDs estoura o tamanho da URL
  for (let i = 0; i < parcelaIds.length; i += LOTE) {
    const { data, error } = await admin
      .from("fin_baixas")
      .select(
        "id, parcela_id, data, competencia, valor, descricao, metodo_pagamento, observacao, created_at",
      )
      .eq("company_id", companyId)
      .in("parcela_id", parcelaIds.slice(i, i + LOTE))
      .order("data", { ascending: true });
    if (error) throw new Error(`baixasPorParcela: ${error.message}`);
    for (const b of data ?? []) {
      const arr = out.get(b.parcela_id as string) ?? [];
      arr.push({ ...b, valor: Number(b.valor) } as FinBaixa);
      out.set(b.parcela_id as string, arr);
    }
  }
  return out;
}

/**
 * Recalcula `valor_realizado`, `status` e `data_pagamento` da parcela a partir
 * das baixas. Chamado depois de toda inserção/remoção.
 *
 * É a ÚNICA fonte de verdade desses três campos — nenhum outro caminho os
 * escreve depois da 0038. Deixar dois lugares atualizando o status significaria
 * divergência na primeira vez que um deles fosse esquecido.
 */
export async function recalcularParcela(
  companyId: string,
  parcelaId: string,
): Promise<void> {
  const admin = createAdminClient();

  const { data: p, error: eP } = await admin
    .from("fin_parcelas")
    .select("valor_previsto, encerrada_em, desconto")
    .eq("company_id", companyId)
    .eq("id", parcelaId)
    .single();
  if (eP) throw new Error(`recalcularParcela: ${eP.message}`);

  const baixas = await listarBaixas(companyId, parcelaId);
  const somaCents = baixas.reduce((s, b) => s + cents(b.valor), 0);
  /**
   * O DESCONTO conta como quitado.
   *
   * Pagar R$ 900 numa conta de R$ 1.000 com R$ 100 de desconto QUITA a conta —
   * os R$ 100 foram perdoados, não ficaram devendo. Sem somá-lo aqui a parcela
   * ficava "parcial" com R$ 100 de saldo, e a tela ainda oferecia "encerrar
   * envelope" numa conta já paga. Era regressão: antes da 0038 o desconto
   * marcava `paga` direto.
   */
  const previstoCents = cents(p.valor_previsto);
  const quitadoCents = somaCents + cents(p.desconto);

  /**
   * Encerrada manualmente conta como paga mesmo com saldo — foi decisão humana
   * registrada, não conta em aberto.
   */
  const encerrada = !!p.encerrada_em;

  const status =
    encerrada || (somaCents > 0 && quitadoCents >= previstoCents)
      ? "paga"
      : somaCents > 0
        ? "parcial"
        : "a_pagar";

  /**
   * `data_pagamento` só é preenchida quando a conta ESTÁ QUITADA — data da
   * última baixa, que é quando terminou de pagar.
   *
   * Preencher já na primeira baixa quebraria os filtros de Contas a pagar, que
   * usam `data_pagamento is null` para separar "a vencer"/"vencidas" de
   * "pagas": um envelope com R$ 380 de R$ 10.000 apareceria como PAGO. Enquanto
   * há saldo, a conta continua em aberto — e as datas de cada gasto vivem nas
   * próprias baixas, que é onde o DRE as lê.
   */
  const dataPagamento =
    status === "paga" && baixas.length ? baixas[baixas.length - 1].data : null;

  const { error } = await admin
    .from("fin_parcelas")
    .update({
      valor_realizado: somaCents / 100,
      status,
      data_pagamento: dataPagamento,
    })
    .eq("company_id", companyId)
    .eq("id", parcelaId);
  if (error) throw new Error(`recalcularParcela/update: ${error.message}`);
}

export interface NovaBaixa {
  data?: string;
  competencia?: string;
  valor: number;
  descricao?: string | null;
  metodo_pagamento?: string | null;
  observacao?: string | null;
}

/**
 * Lança uma baixa e recalcula a parcela.
 *
 * NÃO bloqueia estouro do teto (decisão do requisitante): o dinheiro já saiu, e
 * impedir o registro só produziria despesa invisível. A tela avisa; o banco
 * aceita.
 */
export async function lancarBaixa(
  companyId: string,
  parcelaId: string,
  input: NovaBaixa,
  userId?: string | null,
): Promise<void> {
  const valor = Number(input.valor);
  if (!Number.isFinite(valor) || valor <= 0)
    throw new Error("Valor da baixa deve ser maior que zero.");

  const admin = createAdminClient();

  // A competência PADRÃO é a da parcela — o custo pertence ao envelope, não ao
  // dia da compra. Editável quando a realidade discorda.
  const { data: p, error: eP } = await admin
    .from("fin_parcelas")
    .select("data_competencia, metodo_pagamento")
    .eq("company_id", companyId)
    .eq("id", parcelaId)
    .single();
  if (eP) throw new Error(`lancarBaixa: parcela não encontrada (${eP.message})`);

  const { error } = await admin.from("fin_baixas").insert({
    company_id: companyId,
    parcela_id: parcelaId,
    data: input.data ?? hojeISO(),
    competencia: input.competencia ?? p.data_competencia,
    valor,
    descricao: input.descricao?.trim() || null,
    metodo_pagamento: input.metodo_pagamento ?? p.metodo_pagamento ?? null,
    observacao: input.observacao?.trim() || null,
    created_by: userId ?? null,
  });
  if (error) throw new Error(`lancarBaixa: ${error.message}`);

  await recalcularParcela(companyId, parcelaId);
}

/** Remove uma baixa e recalcula a parcela. */
export async function removerBaixa(companyId: string, baixaId: string): Promise<void> {
  const admin = createAdminClient();

  // Precisa do parcela_id ANTES de apagar, para saber o que recalcular.
  const { data: b, error: eB } = await admin
    .from("fin_baixas")
    .select("parcela_id")
    .eq("company_id", companyId)
    .eq("id", baixaId)
    .single();
  if (eB) throw new Error(`removerBaixa: ${eB.message}`);

  const { error } = await admin
    .from("fin_baixas")
    .delete()
    .eq("company_id", companyId)
    .eq("id", baixaId);
  if (error) throw new Error(`removerBaixa/delete: ${error.message}`);

  await recalcularParcela(companyId, b.parcela_id as string);
}

/**
 * Encerra o envelope com motivo: o saldo não será gasto.
 *
 * NÃO mexe em `valor_previsto`. No regime de competência, previsto é o que foi
 * PLANEJADO, e "planejei 10 mil, gastei 7,3 mil" é a informação útil. Encerrar
 * só tira a conta do "a pagar".
 */
export async function encerrarEnvelope(
  companyId: string,
  parcelaId: string,
  motivo: string,
): Promise<void> {
  const texto = motivo?.trim();
  if (!texto)
    throw new Error(
      "Informe o motivo do encerramento — meses depois ninguém lembra se sobrou por economia ou por esquecimento.",
    );

  const admin = createAdminClient();
  const { error } = await admin
    .from("fin_parcelas")
    .update({ encerrada_em: hojeISO(), encerrada_motivo: texto })
    .eq("company_id", companyId)
    .eq("id", parcelaId);
  if (error) throw new Error(`encerrarEnvelope: ${error.message}`);

  await recalcularParcela(companyId, parcelaId);
}

/** Reabre um envelope encerrado (volta a 'parcial'/'a_pagar'). */
export async function reabrirEnvelope(
  companyId: string,
  parcelaId: string,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("fin_parcelas")
    .update({ encerrada_em: null, encerrada_motivo: null })
    .eq("company_id", companyId)
    .eq("id", parcelaId);
  if (error) throw new Error(`reabrirEnvelope: ${error.message}`);

  await recalcularParcela(companyId, parcelaId);
}
