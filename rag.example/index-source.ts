/**
 * Serviço de indexação RAG.
 * SERVER-SIDE ONLY.
 * Gera chunks de texto, embeddings e persiste em knowledge_chunks.
 * Usa content_hash para evitar reindexação de conteúdo não alterado.
 */

import crypto from "crypto"
import { createAdminClient } from "@/lib/supabase-admin"
import { chunkText } from "./chunk-text"
import { embedBatch, EMBEDDING_MODEL } from "./embeddings"
import { logActivity } from "@/lib/activity-logger"

export type SourceType = "knowledge_source" | "agent_file"

export interface IndexSourceOptions {
  sourceId:     string
  sourceType:   SourceType
  content:      string
  title:        string
  companyId?:   string
  agentId?:     string
  createdBy?:   string
  forceReindex?: boolean
}

export interface IndexSourceResult {
  chunks:  number
  skipped: boolean
}

function md5(text: string): string {
  return crypto.createHash("md5").update(text).digest("hex")
}

function vectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`
}

export async function indexSource(opts: IndexSourceOptions): Promise<IndexSourceResult> {
  const admin = createAdminClient()
  const hash  = md5(opts.content)

  // ── Verificar se conteúdo mudou ──────────────────────────────────────────
  if (!opts.forceReindex) {
    const table = opts.sourceType === "knowledge_source" ? "knowledge_sources" : "agent_files"
    const { data: existing } = await admin
      .from(table)
      .select("content_hash")
      .eq("id", opts.sourceId)
      .single()

    if (existing?.content_hash === hash) {
      return { chunks: 0, skipped: true }
    }
  }

  // ── Marcar como "processing" ─────────────────────────────────────────────
  await setEmbeddingStatus(admin, opts.sourceType, opts.sourceId, "processing")

  try {
    const textChunks = chunkText(opts.content)

    if (textChunks.length === 0) {
      await finalize(admin, opts.sourceType, opts.sourceId, hash, 0)
      return { chunks: 0, skipped: false }
    }

    // ── Apagar chunks antigos ────────────────────────────────────────────
    const col = opts.sourceType === "knowledge_source" ? "knowledge_source_id" : "agent_file_id"
    await admin.from("knowledge_chunks").delete().eq(col, opts.sourceId)

    // ── Gerar embeddings (em lotes de 100) ───────────────────────────────
    // Prefixamos o título da fonte em cada chunk antes de embeddar para que
    // buscas pelo nome da fonte (ex.: "mente do cliente") casem com forte
    // similaridade, mesmo quando o corpo do texto não repete o termo.
    const titlePrefix = opts.title ? `${opts.title}\n\n` : ""
    const embeddings = await embedBatch(textChunks.map(c => titlePrefix + c.content))

    // ── Inserir novos chunks ─────────────────────────────────────────────
    const rows = textChunks.map((chunk, i) => ({
      content:             chunk.content,
      chunk_index:         chunk.chunk_index,
      token_count:         chunk.token_count,
      embedding:           vectorLiteral(embeddings[i]),
      embedding_model:     EMBEDDING_MODEL,
      knowledge_source_id: opts.sourceType === "knowledge_source" ? opts.sourceId : null,
      agent_file_id:       opts.sourceType === "agent_file"       ? opts.sourceId : null,
      company_id:          opts.companyId ?? null,
      agent_id:            opts.agentId   ?? null,
      source_type:         opts.sourceType,
      title:               opts.title,
      content_hash:        hash,
      created_by:          opts.createdBy ?? null,
      metadata:            {},
    }))

    const { error } = await admin.from("knowledge_chunks").insert(rows)
    if (error) throw new Error(error.message)

    await finalize(admin, opts.sourceType, opts.sourceId, hash, textChunks.length)

    void logActivity({
      userId:    opts.createdBy ?? "system",
      eventType: "source",
      action:    "rag_index_completed",
      detail:    opts.title,
      metadata:  {
        source_type: opts.sourceType,
        source_id:   opts.sourceId,
        chunks:      textChunks.length,
      },
      companyId: opts.companyId,
    })

    return { chunks: textChunks.length, skipped: false }

  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido"
    await setEmbeddingStatus(admin, opts.sourceType, opts.sourceId, "error")

    void logActivity({
      userId:    opts.createdBy ?? "system",
      eventType: "source",
      action:    "rag_index_failed",
      detail:    msg,
      metadata:  { source_type: opts.sourceType, source_id: opts.sourceId },
      companyId: opts.companyId,
    })

    throw err
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type AdminClient = ReturnType<typeof createAdminClient>

async function setEmbeddingStatus(
  admin: AdminClient,
  type: SourceType,
  id: string,
  status: string,
): Promise<void> {
  const table = type === "knowledge_source" ? "knowledge_sources" : "agent_files"
  await admin.from(table).update({ embedding_status: status }).eq("id", id)
}

async function finalize(
  admin: AdminClient,
  type: SourceType,
  id: string,
  hash: string,
  _chunks: number,
): Promise<void> {
  const table = type === "knowledge_source" ? "knowledge_sources" : "agent_files"
  await admin.from(table).update({
    embedding_status: "done",
    content_hash:     hash,
  }).eq("id", id)
}
