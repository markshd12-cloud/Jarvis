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

/** Árvore do DRE cacheada (Opção A) + carimbo do último sync bem-sucedido. */
export interface DreEstruturaCache {
  json: unknown | null;
  syncAt: string | null;
}

/** Lê a estrutura do DRE guardada (ou {null,null} se nunca sincronizou). */
export async function getDreEstruturaCache(
  companyId: string,
): Promise<DreEstruturaCache> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("fin_dre_config")
    .select("estrutura_json, estrutura_sync_at")
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw new Error(`getDreEstruturaCache: ${error.message}`);
  return {
    json: (data?.estrutura_json as unknown) ?? null,
    syncAt: (data?.estrutura_sync_at as string | null) ?? null,
  };
}

/**
 * Regrava a árvore do DRE (upsert por empresa). Atualiza SÓ as colunas de
 * estrutura — `cutover_competencia` fica intacto (upsert não toca coluna ausente).
 */
export async function saveDreEstruturaCache(
  companyId: string,
  json: unknown,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("fin_dre_config").upsert(
    {
      company_id: companyId,
      estrutura_json: json as never,
      estrutura_sync_at: new Date().toISOString(),
    },
    { onConflict: "company_id" },
  );
  if (error) throw new Error(`saveDreEstruturaCache: ${error.message}`);
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
