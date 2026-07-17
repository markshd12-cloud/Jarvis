/**
 * Acesso às Business Units (unidades: CPPEM/Colégio/Unicive/Geral). Server-only,
 * escopado por `companyId` (já validado no `finContext`). Validação Zod na entrada.
 */
import "server-only";

import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { fkFriendly, type BusinessUnit } from "./types";

export const buInputSchema = z.object({
  nome: z.string().trim().min(1, "nome obrigatório"),
  slug: z
    .string()
    .trim()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "slug: minúsculas, números e hífen"),
  cnpj: z.string().trim().nullish(),
  cor: z.string().trim().nullish(),
  ordem: z.number().int().nonnegative().optional(),
});
export type BuInput = z.infer<typeof buInputSchema>;

export async function listBus(companyId: string): Promise<BusinessUnit[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("business_units")
    .select("*")
    .eq("company_id", companyId)
    .order("ordem", { ascending: true });
  if (error) throw new Error(`listBus: ${error.message}`);
  return (data ?? []) as BusinessUnit[];
}

export async function createBu(companyId: string, input: BuInput): Promise<BusinessUnit> {
  const v = buInputSchema.parse(input);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("business_units")
    .insert({ company_id: companyId, ...v })
    .select("*")
    .single();
  if (error) throw new Error(`createBu: ${error.message}`);
  return data as BusinessUnit;
}

export async function updateBu(
  companyId: string,
  id: string,
  input: Partial<BuInput>,
): Promise<BusinessUnit> {
  const v = buInputSchema.partial().parse(input);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("business_units")
    .update(v)
    .eq("company_id", companyId)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`updateBu: ${error.message}`);
  return data as BusinessUnit;
}

/** Inativa/reativa (soft — preferir a exclusão quando houver lançamentos). */
export async function setBuAtivo(
  companyId: string,
  id: string,
  ativo: boolean,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("business_units")
    .update({ ativo })
    .eq("company_id", companyId)
    .eq("id", id);
  if (error) throw new Error(`setBuAtivo: ${error.message}`);
}

/** Exclui. O FK `on delete restrict` barra se a BU já for referenciada — vira msg clara. */
export async function deleteBu(companyId: string, id: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("business_units")
    .delete()
    .eq("company_id", companyId)
    .eq("id", id);
  if (error) throw new Error(fkFriendly(error, "BU"));
}
