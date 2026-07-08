import { embed, embedMany } from "ai";

import { vertex } from "@/lib/ai/vertex";

// text-embedding-005 → 768 dimensões (precisa bater com vector(768) no banco).
const embeddingModel = vertex.embeddingModel(
  process.env.EMBEDDING_MODEL ?? "text-embedding-005",
);

/**
 * Gera o embedding de um texto.
 * - RETRIEVAL_DOCUMENT: ao guardar memórias (padrão).
 * - RETRIEVAL_QUERY: ao buscar memórias a partir de uma pergunta.
 */
export async function embedText(
  text: string,
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" = "RETRIEVAL_DOCUMENT",
): Promise<number[]> {
  const { embedding } = await embed({
    model: embeddingModel,
    value: text,
    providerOptions: { vertex: { taskType } },
  });
  return embedding;
}

/** Embeddings em lote (documentos a indexar — ex.: chunks do Notion). */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const { embeddings } = await embedMany({
    model: embeddingModel,
    values: texts,
    providerOptions: { vertex: { taskType: "RETRIEVAL_DOCUMENT" } },
  });
  return embeddings;
}
