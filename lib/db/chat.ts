import type { UIMessage } from "ai";

import { parseMessage } from "@/lib/chat/attachments";
import { createClient } from "@/lib/supabase/server";

/** Texto concatenado das partes de texto de uma mensagem. */
export function messageText(message: UIMessage): string {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

export interface ConversationSummary {
  id: string;
  title: string | null;
  updated_at: string;
  project_id?: string | null;
}

/**
 * Lista as conversas do usuário (mais recentes primeiro) para o painel lateral.
 * RLS (`conversations_select_own`) já limita ao próprio usuário; usa o índice
 * (user_id, updated_at desc).
 *
 * `filter`: undefined = todas; "loose" = só chats fora de projeto; string =
 * chats de um projeto específico. Resiliente: se a coluna project_id ainda não
 * existe (migration 0007 não aplicada), cai para a listagem legada.
 */
export async function listConversations(
  filter?: "loose" | string,
  limit = 50,
): Promise<ConversationSummary[]> {
  const supabase = await createClient();
  let query = supabase
    .from("conversations")
    .select("id, title, updated_at, project_id")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (filter === "loose") query = query.is("project_id", null);
  else if (filter) query = query.eq("project_id", filter);

  const { data, error } = await query;
  if (!error) return data ?? [];

  // project_id ausente (pré-migration): lista legada, tudo como "solto".
  if (filter && filter !== "loose") return []; // sem projetos ainda
  const { data: legacy } = await supabase
    .from("conversations")
    .select("id, title, updated_at")
    .order("updated_at", { ascending: false })
    .limit(limit);
  return legacy ?? [];
}

/**
 * Cria uma conversa vazia e devolve o id. Pode nascer vinculada a um projeto
 * (contexto/instruções) e/ou a um agente (persona). Usado pelos botões "Novo
 * chat neste projeto" e "Conversar com agente".
 */
export async function createConversation(opts?: {
  projectId?: string | null;
  agentId?: string | null;
}): Promise<string | null> {
  const supabase = await createClient();
  const id = crypto.randomUUID();
  const { error } = await supabase.from("conversations").insert({
    id,
    title: "Nova conversa",
    ...(opts?.projectId ? { project_id: opts.projectId } : {}),
    ...(opts?.agentId ? { agent_id: opts.agentId } : {}),
  });
  if (error) {
    console.error("[chat] createConversation:", error);
    return null;
  }
  return id;
}

/** Carrega as mensagens de uma conversa (RLS garante que é do usuário). */
export async function loadConversation(
  conversationId: string,
): Promise<UIMessage[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("messages")
    .select("id, role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  return (data ?? []).map((row) => ({
    id: row.id,
    role: row.role as UIMessage["role"],
    parts: [{ type: "text", text: row.content }],
  }));
}

/**
 * Cria/atualiza a conversa e grava as mensagens novas (idempotente).
 * user_id e company_id são preenchidos pelos defaults da tabela.
 */
export async function saveConversation(
  conversationId: string,
  messages: UIMessage[],
  agentId?: string | null,
): Promise<void> {
  const supabase = await createClient();

  // Título = texto digitado (sem marcadores de anexo); se a 1ª mensagem só tem
  // arquivo/imagem, usa o nome do anexo. Mantém o painel lateral legível.
  const firstUser = messages.find((m) => m.role === "user");
  let title = "Nova conversa";
  if (firstUser) {
    const { body, files } = parseMessage(messageText(firstUser));
    const imageName = firstUser.parts.find((p) => p.type === "file")?.filename;
    title = (
      body.trim() ||
      files[0]?.name ||
      imageName ||
      "Nova conversa"
    ).slice(0, 80);
  }

  await supabase
    .from("conversations")
    .upsert(
      {
        id: conversationId,
        title,
        updated_at: new Date().toISOString(),
        // string = vincula agente; null = desvincula; undefined = não mexe.
        ...(agentId !== undefined ? { agent_id: agentId } : {}),
      },
      { onConflict: "id" },
    );

  const now = Date.now();
  const rows = messages.map((message, index) => ({
    id: message.id,
    conversation_id: conversationId,
    role: message.role,
    content: messageText(message),
    created_at: new Date(now + index).toISOString(),
  }));

  // Insere só as mensagens novas; mantém as já gravadas intactas.
  await supabase
    .from("messages")
    .upsert(rows, { onConflict: "id", ignoreDuplicates: true });
}
