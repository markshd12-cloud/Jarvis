/**
 * Acesso aos Centros de Custo. Server-only, escopado por `companyId`. O `ca_centro_id`
 * vem do seed (read-only); criação manual entra sem ele. Nunca exclui (inativa).
 */
import "server-only";

import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { fkFriendly, type FinCentro } from "./types";

export const centroInputSchema = z.object({
  nome: z.string().trim().min(1, "nome obrigatório"),
  codigo: z.string().trim().nullish(),
  ordem: z.number().int().nonnegative().optional(),
});
export type CentroInput = z.infer<typeof centroInputSchema>;

export async function listCentros(companyId: string): Promise<FinCentro[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("fin_centros_custo")
    .select("*")
    .eq("company_id", companyId)
    .order("ordem", { ascending: true })
    .order("nome", { ascending: true });
  if (error) throw new Error(`listCentros: ${error.message}`);
  return (data ?? []) as FinCentro[];
}

export async function createCentro(
  companyId: string,
  input: CentroInput,
): Promise<FinCentro> {
  const v = centroInputSchema.parse(input);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("fin_centros_custo")
    .insert({ company_id: companyId, ...v })
    .select("*")
    .single();
  if (error) throw new Error(`createCentro: ${error.message}`);
  return data as FinCentro;
}

export async function updateCentro(
  companyId: string,
  id: string,
  input: Partial<CentroInput>,
): Promise<FinCentro> {
  const v = centroInputSchema.partial().parse(input);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("fin_centros_custo")
    .update(v)
    .eq("company_id", companyId)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`updateCentro: ${error.message}`);
  return data as FinCentro;
}

export async function setCentroAtivo(
  companyId: string,
  id: string,
  ativo: boolean,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("fin_centros_custo")
    .update({ ativo })
    .eq("company_id", companyId)
    .eq("id", id);
  if (error) throw new Error(`setCentroAtivo: ${error.message}`);
}

/** Exclui. FK `on delete restrict` barra se já referenciado por lançamentos. */
export async function deleteCentro(companyId: string, id: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("fin_centros_custo")
    .delete()
    .eq("company_id", companyId)
    .eq("id", id);
  if (error) throw new Error(fkFriendly(error, "Centro"));
}
