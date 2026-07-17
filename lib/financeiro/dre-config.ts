/**
 * Config do DRE v2 (Passo 11): a competência de CUTOVER da despesa por empresa.
 *
 * `cutover_competencia` (AAAA-MM) = 1º mês em que o DRE lê a despesa das nossas
 * `fin_parcelas`; competências anteriores seguem lendo o Conta Azul ao vivo.
 * `null` (ou sem linha) = tudo do CA — o FALLBACK seguro, idêntico ao comportamento
 * de hoje. Server-only, escopado por `companyId` (já validado no `finContext`).
 */
import "server-only";

import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";

const compSchema = z.string().regex(/^\d{4}-\d{2}$/, "competência AAAA-MM");

export interface DreConfig {
  cutover_competencia: string | null;
  updated_at: string | null;
}

export async function getDreConfig(companyId: string): Promise<DreConfig> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("fin_dre_config")
    .select("cutover_competencia, updated_at")
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw new Error(`getDreConfig: ${error.message}`);
  return {
    cutover_competencia: (data?.cutover_competencia as string | null) ?? null,
    updated_at: (data?.updated_at as string | null) ?? null,
  };
}

/**
 * Só a competência de cutover, para o motor do DRE. DEGRADA para `null` (tudo do
 * CA) em QUALQUER erro — inclusive tabela ainda não migrada —, para que ligar o
 * código do Passo 11 nunca quebre o DRE ao vivo antes de aplicar a 0025.
 */
export async function getCutoverCompetencia(companyId: string): Promise<string | null> {
  try {
    return (await getDreConfig(companyId)).cutover_competencia;
  } catch {
    return null;
  }
}

/** Define (ou limpa, com `null`) a competência de cutover. Upsert por empresa. */
export async function setCutover(
  companyId: string,
  competencia: string | null,
): Promise<DreConfig> {
  const comp = competencia == null ? null : compSchema.parse(competencia);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("fin_dre_config")
    .upsert(
      {
        company_id: companyId,
        cutover_competencia: comp,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "company_id" },
    )
    .select("cutover_competencia, updated_at")
    .single();
  if (error) throw new Error(`setCutover: ${error.message}`);
  return {
    cutover_competencia: (data.cutover_competencia as string | null) ?? null,
    updated_at: (data.updated_at as string | null) ?? null,
  };
}
