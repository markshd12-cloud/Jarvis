import crypto from "node:crypto";

import { chunkText } from "@/lib/ai/chunk";
import { embedTexts } from "@/lib/ai/embeddings";
import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

// Fontes manuais vivem em documents/document_chunks com esta origem — assim entram
// no mesmo RAG híbrido (searchKnowledge) junto do Notion, sem código novo de busca.
const SOURCE = "manual";

export interface ManualSource {
  id: string; // external_id (uuid gerado por nós)
  title: string;
  content: string;
  updatedAt: string | null;
}

function md5(text: string): string {
  return crypto.createHash("md5").update(text).digest("hex");
}

/** Lista as fontes manuais da empresa (mais recentes primeiro). */
export async function listManualSources(companyId: string): Promise<ManualSource[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("documents")
    .select("external_id, title, content, synced_at")
    .eq("company_id", companyId)
    .eq("source", SOURCE)
    .order("synced_at", { ascending: false });

  return (data ?? []).map((d) => ({
    id: d.external_id as string,
    title: (d.title as string | null) ?? "",
    content: (d.content as string | null) ?? "",
    updatedAt: d.synced_at as string | null,
  }));
}

/** Re-gera os chunks/embeddings de um documento (apaga os antigos e insere os novos). */
async function reindexChunks(
  admin: AdminClient,
  companyId: string,
  documentId: string,
  title: string,
  content: string,
): Promise<void> {
  await admin.from("document_chunks").delete().eq("document_id", documentId);

  const chunks = chunkText(content);
  if (chunks.length === 0) return;

  // Prefixa o título no embedding (buscas pelo NOME da fonte casam melhor).
  const prefix = title ? `${title}\n\n` : "";
  const embeddings = await embedTexts(chunks.map((c) => prefix + c.content));
  const rows = chunks.map((c, i) => ({
    document_id: documentId,
    company_id: companyId,
    content: c.content,
    embedding: embeddings[i],
  }));
  await admin.from("document_chunks").insert(rows);
}

/** Cria uma nova fonte manual e a indexa. */
export async function createManualSource(
  companyId: string,
  title: string,
  content: string,
): Promise<void> {
  const admin = createAdminClient();
  const now = new Date().toISOString();

  const { data: doc, error } = await admin
    .from("documents")
    .insert({
      company_id: companyId,
      source: SOURCE,
      external_id: crypto.randomUUID(),
      title,
      content,
      content_hash: md5(content),
      last_edited_at: now,
      synced_at: now,
    })
    .select("id")
    .single();
  if (error || !doc) throw new Error(error?.message ?? "Falha ao criar fonte.");

  await reindexChunks(admin, companyId, doc.id, title, content);
}

/** Atualiza título/conteúdo de uma fonte manual (só da própria empresa) e re-indexa. */
export async function updateManualSource(
  companyId: string,
  externalId: string,
  title: string,
  content: string,
): Promise<void> {
  const admin = createAdminClient();
  const now = new Date().toISOString();

  const { data: doc, error } = await admin
    .from("documents")
    .update({
      title,
      content,
      content_hash: md5(content),
      last_edited_at: now,
      synced_at: now,
    })
    .eq("company_id", companyId)
    .eq("source", SOURCE)
    .eq("external_id", externalId)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!doc) throw new Error("Fonte não encontrada.");

  await reindexChunks(admin, companyId, doc.id, title, content);
}

/** Exclui uma fonte manual (os chunks somem em cascata pela FK). */
export async function deleteManualSource(
  companyId: string,
  externalId: string,
): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("documents")
    .delete()
    .eq("company_id", companyId)
    .eq("source", SOURCE)
    .eq("external_id", externalId);
}
