import { assertCanManageCompany } from "@/lib/db/permissions";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export interface Agent {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
}

/** Resumo p/ o menu "/" do chat (sem o prompt). */
export interface AgentOption {
  id: string;
  name: string;
  description: string;
}

export interface AgentInput {
  name: string;
  description: string;
  systemPrompt: string;
}

/** Agentes da empresa do usuário (RLS filtra por empresa; superadmin vê todas). */
export async function listAgents(): Promise<Agent[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agents")
    .select("id, name, description, system_prompt")
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return data.map(mapAgent);
}

/** Um agente por id (RLS garante que é da empresa do usuário). */
export async function getAgent(id: string): Promise<Agent | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("agents")
    .select("id, name, description, system_prompt")
    .eq("id", id)
    .maybeSingle();
  return data ? mapAgent(data) : null;
}

/** Agente atualmente vinculado a uma conversa (id + nome), para o estado inicial. */
export async function getConversationAgent(
  conversationId: string,
): Promise<AgentOption | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("conversations")
    .select("agents ( id, name, description )")
    .eq("id", conversationId)
    .maybeSingle();
  if (!data) return null;
  const agent = (
    data as unknown as {
      agents: { id: string; name: string; description: string } | null;
    }
  ).agents;
  return agent ?? null;
}

/** Persona do agente vinculado à conversa (para injetar no system). */
export async function getConversationAgentContext(
  conversationId: string,
): Promise<{ name: string; systemPrompt: string } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conversations")
    .select("agents ( name, system_prompt )")
    .eq("id", conversationId)
    .maybeSingle();
  if (error || !data) return null;
  const agent = (
    data as unknown as {
      agents: { name: string; system_prompt: string } | null;
    }
  ).agents;
  if (!agent?.system_prompt?.trim()) return null;
  return { name: agent.name, systemPrompt: agent.system_prompt };
}

// --- Escrita (gestores; service_role) --------------------------------------

export async function createAgent(
  companyId: string,
  input: AgentInput,
): Promise<string> {
  await assertCanManageCompany(companyId);
  const clean = validate(input);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("agents")
    .insert({ company_id: companyId, ...clean })
    .select("id")
    .single();
  if (error || !data) {
    if (error?.code === "23505") throw new Error("Já existe um agente com esse nome.");
    throw new Error(error?.message ?? "Falha ao criar o agente.");
  }
  return data.id as string;
}

export async function updateAgent(
  agentId: string,
  input: AgentInput,
): Promise<string> {
  const admin = createAdminClient();
  const { data: agent } = await admin
    .from("agents")
    .select("company_id")
    .eq("id", agentId)
    .maybeSingle();
  if (!agent) throw new Error("Agente não encontrado.");
  await assertCanManageCompany(agent.company_id);

  const clean = validate(input);
  const { error } = await admin
    .from("agents")
    .update({ ...clean, updated_at: new Date().toISOString() })
    .eq("id", agentId);
  if (error) {
    if (error.code === "23505") throw new Error("Já existe um agente com esse nome.");
    throw new Error(error.message);
  }
  return agent.company_id as string;
}

export async function deleteAgent(agentId: string): Promise<string> {
  const admin = createAdminClient();
  const { data: agent } = await admin
    .from("agents")
    .select("company_id")
    .eq("id", agentId)
    .maybeSingle();
  if (!agent) throw new Error("Agente não encontrado.");
  await assertCanManageCompany(agent.company_id);

  const { error } = await admin.from("agents").delete().eq("id", agentId);
  if (error) throw new Error(error.message);
  return agent.company_id as string;
}

function validate(input: AgentInput): AgentInput {
  const name = input.name.trim();
  const systemPrompt = input.systemPrompt.trim();
  if (!name) throw new Error("Informe o nome do agente.");
  if (!systemPrompt) throw new Error("Informe o prompt do agente.");
  return {
    name: name.slice(0, 60),
    description: input.description.trim().slice(0, 200),
    systemPrompt: systemPrompt.slice(0, 20_000),
  };
}

function mapAgent(row: {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
}): Agent {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    systemPrompt: row.system_prompt,
  };
}
