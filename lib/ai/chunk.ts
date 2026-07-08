/**
 * Divide texto em chunks com sobreposição, quebrando em limites de parágrafo/frase.
 * Alvo: ~1000 tokens por chunk, ~120 de overlap (1 token ≈ 3,5 chars PT/EN).
 */
export interface TextChunk {
  content: string;
  index: number;
  tokens: number;
}

const CHARS_PER_TOKEN = 3.5;
const CHUNK_CHARS = Math.floor(1000 * CHARS_PER_TOKEN); // ~3500
const OVERLAP_CHARS = Math.floor(120 * CHARS_PER_TOKEN); // ~420

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function chunkText(text: string): TextChunk[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];

  const chunks: TextChunk[] = [];
  let start = 0;
  let index = 0;

  while (start < clean.length) {
    let end = Math.min(start + CHUNK_CHARS, clean.length);

    // Tenta quebrar num limite natural dentro da janela (parágrafo, depois frase).
    if (end < clean.length) {
      const para = clean.lastIndexOf("\n\n", end);
      if (para > start + CHUNK_CHARS / 2) {
        end = para + 2;
      } else {
        const sentence = Math.max(
          clean.lastIndexOf(". ", end),
          clean.lastIndexOf(".\n", end),
          clean.lastIndexOf("! ", end),
          clean.lastIndexOf("? ", end),
        );
        if (sentence > start + CHUNK_CHARS / 2) end = sentence + 2;
      }
    }

    const content = clean.slice(start, end).trim();
    if (content) {
      chunks.push({ content, index: index++, tokens: estimateTokens(content) });
    }

    const next = end - OVERLAP_CHARS;
    start = next > start ? next : end;
  }

  return chunks;
}
