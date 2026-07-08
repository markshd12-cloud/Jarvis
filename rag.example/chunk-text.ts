/**
 * Divide texto em chunks com sobreposição para indexação RAG.
 * Alvo: ~1000 tokens por chunk, ~120 tokens de overlap.
 * 1 token ≈ 3,5 chars (mistura português/inglês).
 */

export interface TextChunk {
  content:     string
  chunk_index: number
  token_count: number
}

const CHARS_PER_TOKEN = 3.5
const CHUNK_TOKENS    = 1000
const OVERLAP_TOKENS  = 120

const CHUNK_CHARS   = Math.floor(CHUNK_TOKENS   * CHARS_PER_TOKEN) // 3500
const OVERLAP_CHARS = Math.floor(OVERLAP_TOKENS * CHARS_PER_TOKEN) // 420

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

export function chunkText(text: string): TextChunk[] {
  const clean = text.replace(/\r\n/g, "\n").trim()
  if (!clean) return []

  const chunks: TextChunk[] = []
  let start = 0
  let index = 0

  while (start < clean.length) {
    const rawEnd = Math.min(start + CHUNK_CHARS, clean.length)
    let end = rawEnd

    // Quebrar no limite de parágrafo mais próximo (antes do fim da janela)
    if (end < clean.length) {
      const lastPara = clean.lastIndexOf("\n\n", end)
      if (lastPara > start + CHUNK_CHARS / 2) {
        end = lastPara + 2
      } else {
        // Quebrar na última frase dentro da janela
        const sentenceEnd = Math.max(
          clean.lastIndexOf(". ",  end),
          clean.lastIndexOf(".\n", end),
          clean.lastIndexOf("! ",  end),
          clean.lastIndexOf("? ",  end),
        )
        if (sentenceEnd > start + CHUNK_CHARS / 2) {
          end = sentenceEnd + 2
        }
      }
    }

    const content = clean.slice(start, end).trim()
    if (content) {
      chunks.push({ content, chunk_index: index++, token_count: estimateTokens(content) })
    }

    // Próximo chunk começa com overlap (nunca retrocede)
    const next = end - OVERLAP_CHARS
    start = next > start ? next : end
  }

  return chunks
}
