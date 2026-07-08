/**
 * Wrapper para embeddings do Google Gemini (gemini-embedding-001).
 * SERVER-SIDE ONLY — nunca importar em Client Components.
 *
 * Autenticação (nesta ordem):
 *   1. GEMINI_API_KEY (se presente) — via ?key=
 *   2. GOOGLE_SERVICE_ACCOUNT_KEY — via Bearer token (service account)
 *
 * Produz vetores de 1536 dimensões (outputDimensionality) para manter
 * compatibilidade com as colunas vector(1536) já existentes no banco.
 */

import { getServiceAccountToken } from "@/lib/gemini-service-account"

export const EMBEDDING_MODEL = "gemini-embedding-001"
export const EMBEDDING_DIMS  = 1536

const BASE = "https://generativelanguage.googleapis.com/v1beta"
const MAX_CHARS = 8_000

function sanitize(text: string): string {
  return text.replace(/\n+/g, " ").slice(0, MAX_CHARS)
}

/** Monta URL + headers de autenticação (API key ou service account). */
async function authParts(): Promise<{ keyParam: string; headers: Record<string, string> }> {
  const apiKey = process.env.GEMINI_API_KEY
  if (apiKey) {
    return { keyParam: `?key=${apiKey}`, headers: { "Content-Type": "application/json" } }
  }
  const token = await getServiceAccountToken()
  if (!token) {
    throw new Error("Sem credenciais Gemini. Configure GEMINI_API_KEY ou GOOGLE_SERVICE_ACCOUNT_KEY.")
  }
  return { keyParam: "", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` } }
}

interface EmbedValue { values: number[] }

/** Gera embedding para um único texto. */
export async function embedText(text: string): Promise<number[]> {
  const { keyParam, headers } = await authParts()
  const res = await fetch(`${BASE}/models/${EMBEDDING_MODEL}:embedContent${keyParam}`, {
    method:  "POST",
    headers,
    body: JSON.stringify({
      model:                `models/${EMBEDDING_MODEL}`,
      content:              { parts: [{ text: sanitize(text) }] },
      outputDimensionality: EMBEDDING_DIMS,
    }),
  })
  if (!res.ok) {
    throw new Error(`Gemini embeddings ${res.status}: ${await res.text()}`)
  }
  const data = await res.json() as { embedding?: EmbedValue }
  const values = data.embedding?.values
  if (!values || values.length === 0) throw new Error("Gemini embeddings: resposta sem 'embedding.values'")
  return values
}

/** Gera embeddings em batch via batchEmbedContents (em lotes de 100). */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []

  const BATCH = 100
  const results: number[][] = []

  for (let i = 0; i < texts.length; i += BATCH) {
    const slice = texts.slice(i, i + BATCH)
    const { keyParam, headers } = await authParts()
    const res = await fetch(`${BASE}/models/${EMBEDDING_MODEL}:batchEmbedContents${keyParam}`, {
      method:  "POST",
      headers,
      body: JSON.stringify({
        requests: slice.map(t => ({
          model:                `models/${EMBEDDING_MODEL}`,
          content:              { parts: [{ text: sanitize(t) }] },
          outputDimensionality: EMBEDDING_DIMS,
        })),
      }),
    })
    if (!res.ok) {
      throw new Error(`Gemini batch embeddings ${res.status}: ${await res.text()}`)
    }
    const data = await res.json() as { embeddings?: EmbedValue[] }
    const embs = data.embeddings
    if (!embs || embs.length !== slice.length) {
      throw new Error(`Gemini batch embeddings: esperava ${slice.length} vetores, recebeu ${embs?.length ?? 0}`)
    }
    results.push(...embs.map(e => e.values))
  } 

  return results
}
