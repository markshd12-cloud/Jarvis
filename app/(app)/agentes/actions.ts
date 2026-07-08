"use server";

import { revalidatePath } from "next/cache";

import { createAgent, deleteAgent, updateAgent } from "@/lib/db/agents";
import { getCompanyId } from "@/lib/db/company";

export type AgentActionState = { ok?: boolean; error?: string };

const fail = (e: unknown): AgentActionState => ({
  error: e instanceof Error ? e.message : "Falha ao salvar.",
});

function readInput(formData: FormData) {
  return {
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
    systemPrompt: String(formData.get("systemPrompt") ?? ""),
  };
}

export async function createAgentAction(
  _prev: AgentActionState,
  formData: FormData,
): Promise<AgentActionState> {
  const companyId = await getCompanyId();
  if (!companyId) return { error: "Empresa não encontrada." };
  try {
    await createAgent(companyId, readInput(formData));
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/agentes");
  return { ok: true };
}

export async function updateAgentAction(
  _prev: AgentActionState,
  formData: FormData,
): Promise<AgentActionState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Agente inválido." };
  try {
    await updateAgent(id, readInput(formData));
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/agentes");
  return { ok: true };
}

export async function deleteAgentAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  try {
    await deleteAgent(id);
  } catch {
    /* ignora — a UI recarrega e mostra o estado atual */
  }
  revalidatePath("/agentes");
}
