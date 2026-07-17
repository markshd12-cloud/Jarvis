/**
 * Recorrências (Passo 8): despesas fixas (aluguel, salário, assinatura) que se
 * MATERIALIZAM em despesa+parcela por competência. Server-only, escopado por
 * `companyId`. A materialização é idempotente — chave `recorrencia_id + competência`
 * (mês). Editar a recorrência NÃO mexe nas parcelas já geradas. Dia inválido no mês
 * (ex.: 31 em fev) cai no último dia. `anual` gera só no mês de criação (created_at).
 */
import "server-only";

import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { fkFriendly, PERIODICIDADES, type FinRecorrencia } from "./types";

export const recorrenciaInputSchema = z.object({
  descricao: z.string().trim().min(1, "descrição obrigatória"),
  categoria_id: z.string().uuid("categoria obrigatória"),
  bu_id: z.string().uuid("BU obrigatória"),
  colaborador_id: z.string().uuid().nullish(),
  valor_previsto: z.coerce.number().nonnegative(),
  dia_vencimento: z.coerce.number().int().min(1).max(31),
  periodicidade: z.enum(PERIODICIDADES as [string, ...string[]]),
});
export type RecorrenciaInput = z.infer<typeof recorrenciaInputSchema>;

export async function listRecorrencias(companyId: string): Promise<FinRecorrencia[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("fin_recorrencias")
    .select("*")
    .eq("company_id", companyId)
    .order("descricao", { ascending: true });
  if (error) throw new Error(`listRecorrencias: ${error.message}`);
  return (data ?? []) as FinRecorrencia[];
}

export async function createRecorrencia(
  companyId: string,
  input: RecorrenciaInput,
): Promise<FinRecorrencia> {
  const v = recorrenciaInputSchema.parse(input);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("fin_recorrencias")
    .insert({ company_id: companyId, ...v })
    .select("*")
    .single();
  if (error) throw new Error(`createRecorrencia: ${error.message}`);
  return data as FinRecorrencia;
}

export async function updateRecorrencia(
  companyId: string,
  id: string,
  input: Partial<RecorrenciaInput>,
): Promise<FinRecorrencia> {
  const v = recorrenciaInputSchema.partial().parse(input);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("fin_recorrencias")
    .update(v)
    .eq("company_id", companyId)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`updateRecorrencia: ${error.message}`);
  return data as FinRecorrencia;
}

export async function setRecorrenciaAtivo(
  companyId: string,
  id: string,
  ativo: boolean,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("fin_recorrencias")
    .update({ ativo })
    .eq("company_id", companyId)
    .eq("id", id);
  if (error) throw new Error(`setRecorrenciaAtivo: ${error.message}`);
}

/** Exclui. FK `on delete set null` nas despesas geradas — solta o vínculo, não apaga. */
export async function deleteRecorrencia(companyId: string, id: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("fin_recorrencias")
    .delete()
    .eq("company_id", companyId)
    .eq("id", id);
  if (error) throw new Error(fkFriendly(error, "Recorrência"));
}

const ultimoDiaDoMes = (ano: number, mes1a12: number) =>
  new Date(Date.UTC(ano, mes1a12, 0)).getUTCDate();

/**
 * Materializa as recorrências ativas na competência (mês). Idempotente: pula quem
 * já tem despesa gerada naquele mês. Retorna quantas geradas e quantas puladas.
 */
export async function materializar(
  companyId: string,
  competencia: string, // "AAAA-MM"
): Promise<{ gerados: number; pulados: number; erros: string[] }> {
  if (!/^\d{4}-\d{2}$/.test(competencia))
    throw new Error("competência inválida (AAAA-MM)");
  const [ano, mes] = competencia.split("-").map(Number);

  const admin = createAdminClient();
  const recs = (await listRecorrencias(companyId)).filter((r) => r.ativo);

  // Despesas já geradas por recorrência (qualquer competência) → mês da 1ª parcela.
  const { data: jaGeradas, error: eJa } = await admin
    .from("fin_despesas")
    .select("id, recorrencia_id, fin_parcelas ( data_competencia )")
    .eq("company_id", companyId)
    .not("recorrencia_id", "is", null);
  if (eJa) throw new Error(`materializar (existentes): ${eJa.message}`);

  const jaNoMes = new Set<string>();
  for (const d of jaGeradas ?? []) {
    const ps = (d.fin_parcelas ?? []) as { data_competencia: string }[];
    for (const p of ps) {
      if (p.data_competencia?.slice(0, 7) === competencia)
        jaNoMes.add(d.recorrencia_id as string);
    }
  }

  let gerados = 0;
  let pulados = 0;
  const erros: string[] = [];

  for (const r of recs) {
    // Anual: só gera no mês de criação.
    if (r.periodicidade === "anual") {
      const mesCriacao = r.created_at?.slice(5, 7);
      if (mesCriacao !== competencia.slice(5, 7)) continue;
    }
    if (jaNoMes.has(r.id)) {
      pulados++;
      continue;
    }

    const dia = Math.min(r.dia_vencimento, ultimoDiaDoMes(ano, mes));
    const dataVenc = `${competencia}-${String(dia).padStart(2, "0")}`;
    const dataComp = `${competencia}-01`;

    const { data: desp, error: e1 } = await admin
      .from("fin_despesas")
      .insert({
        company_id: companyId,
        descricao: r.descricao,
        categoria_id: r.categoria_id,
        colaborador_id: r.colaborador_id,
        valor_total: r.valor_previsto,
        num_parcelas: 1,
        recorrencia_id: r.id,
      })
      .select("id")
      .single();
    if (e1) {
      erros.push(`${r.descricao}: ${e1.message}`);
      continue;
    }
    const { error: e2 } = await admin.from("fin_parcelas").insert({
      company_id: companyId,
      despesa_id: desp.id,
      numero: 1,
      bu_id: r.bu_id,
      valor_previsto: r.valor_previsto,
      data_competencia: dataComp,
      data_vencimento: dataVenc,
      status: "a_pagar",
    });
    if (e2) {
      await admin.from("fin_despesas").delete().eq("company_id", companyId).eq("id", desp.id);
      erros.push(`${r.descricao}: ${e2.message}`);
      continue;
    }
    gerados++;
  }

  return { gerados, pulados, erros };
}
