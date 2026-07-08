import { createClient } from "@/lib/supabase/server";

export interface ProjectSummary {
  id: string;
  name: string;
  updated_at: string;
}

export interface Project extends ProjectSummary {
  instructions: string | null;
}

// Enquanto a migration 0007 não roda, a tabela não existe: degradamos para
// "sem projetos" em vez de quebrar o chat. (código undefined/42P01 = tabela ausente)
function tableMissing(error: { code?: string } | null): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

/** Lista os projetos do usuário (mais recentes primeiro). */
export async function listProjects(limit = 50): Promise<ProjectSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("id, name, updated_at")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) {
    if (!tableMissing(error)) console.error("[projects] listProjects:", error);
    return [];
  }
  return data ?? [];
}

/** Carrega um projeto (com instruções) — null se não existir/sem acesso. */
export async function getProject(id: string): Promise<Project | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("id, name, instructions, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (!tableMissing(error)) console.error("[projects] getProject:", error);
    return null;
  }
  return data;
}

/** Cria um projeto e devolve o id (company_id/user_id vêm dos defaults). */
export async function createProject(
  name: string,
  instructions?: string,
): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .insert({ name, instructions: instructions?.trim() || null })
    .select("id")
    .single();
  if (error) {
    console.error("[projects] createProject:", error);
    return null;
  }
  return data.id;
}

/** Atualiza nome e/ou instruções de um projeto. */
export async function updateProject(
  id: string,
  patch: { name?: string; instructions?: string | null },
): Promise<boolean> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("projects")
    .update({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.instructions !== undefined
        ? { instructions: patch.instructions?.trim() || null }
        : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) {
    console.error("[projects] updateProject:", error);
    return false;
  }
  return true;
}

/** Exclui um projeto (os chats viram soltos via ON DELETE SET NULL). */
export async function deleteProject(id: string): Promise<boolean> {
  const supabase = await createClient();
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) {
    console.error("[projects] deleteProject:", error);
    return false;
  }
  return true;
}

/**
 * Instruções do projeto ao qual a conversa pertence (para injetar no system).
 * null se a conversa é solta ou o projeto não tem instruções.
 */
export async function getConversationProjectContext(
  conversationId: string,
): Promise<{ name: string; instructions: string } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conversations")
    .select("projects ( name, instructions )")
    .eq("id", conversationId)
    .maybeSingle();
  if (error || !data) return null;
  const project = (
    data as unknown as {
      projects: { name: string; instructions: string | null } | null;
    }
  ).projects;
  if (!project?.instructions?.trim()) return null;
  return { name: project.name, instructions: project.instructions };
}
