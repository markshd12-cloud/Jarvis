import { generateObject, type UIMessage } from "ai";
import { z } from "zod";

import { embedText } from "@/lib/ai/embeddings";
import { chatModel } from "@/lib/ai/vertex";
import { messageText } from "@/lib/db/chat";
import { createClient } from "@/lib/supabase/server";

// Calibráveis por env (decisão "ver o mais útil").
const MIN_CONFIDENCE = Number(process.env.MEMORY_MIN_CONFIDENCE ?? "0.6");
const DEDUP_THRESHOLD = Number(process.env.MEMORY_DEDUP_THRESHOLD ?? "0.9");

const ExtractionSchema = z.object({
  memorias: z.array(
    z.object({
      conteudo: z.string().describe("o fato/preferência/decisão, em 1 frase"),
      tipo: z.enum(["fato", "preferencia", "decisao", "entidade"]),
      confianca: z.number().min(0).max(1),
    }),
  ),
});

/**
 * Mente evolutiva: lê a última troca da conversa, extrai memórias duráveis,
 * valida (confiança mínima + dedup por similaridade) e guarda as aprovadas.
 */
export async function distillMemories(
  conversationId: string,
  messages: UIMessage[],
): Promise<void> {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const lastAssistant = [...messages]
    .reverse()
    .find((m) => m.role === "assistant");
  if (!lastUser && !lastAssistant) return;

  const exchange = [
    lastUser ? `Usuário: ${messageText(lastUser)}` : "",
    lastAssistant ? `Jarvis: ${messageText(lastAssistant)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const { object } = await generateObject({
    model: chatModel,
    schema: ExtractionSchema,
    prompt:
      "Você mantém a memória de longo prazo de um assistente corporativo. " +
      "Extraia da conversa SOMENTE fatos objetivos e duráveis sobre a empresa, " +
      "clientes, produtos, processos, decisões ou preferências do usuário — " +
      "preferindo o que o USUÁRIO afirma como verdade.\n" +
      "NUNCA registre: resultados de busca, ausência de informação ('não encontrado'), " +
      "capacidades/limitações do assistente, status do sistema, perguntas, pedidos " +
      "('busque'), saudações ou qualquer meta-conversa. Nunca registre frases negativas. " +
      "Nunca registre dados sensíveis (senha, CPF, cartão). Responda em português. " +
      "Se não houver fato objetivo e durável, retorne lista vazia. " +
      "Dê uma confiança de 0 a 1 para cada item.\n\n" +
      exchange,
  });

  if (object.memorias.length === 0) return;

  // Rede de segurança: descarta candidatos negativos/meta que escaparem do prompt.
  const BLOCKLIST =
    /(n[ãa]o\s+(foi|foram|h[áa]|t[eê]m|possui|encontr|exist|consig)|busca[s]?\s+anterior|n[ãa]o\s+encontr|sem\s+informa|assistente|sistema)/i;

  const supabase = await createClient();

  for (const item of object.memorias) {
    if (item.confianca < MIN_CONFIDENCE) continue;
    if (BLOCKLIST.test(item.conteudo)) continue;

    const embedding = await embedText(item.conteudo);

    // Dedup: já existe memória equivalente nesta empresa?
    const { data: similar } = await supabase.rpc("match_memories", {
      query_embedding: embedding,
      match_threshold: DEDUP_THRESHOLD,
      match_count: 1,
    });
    if (similar && similar.length > 0) continue;

    // company_id e source_user_id são preenchidos pelos defaults da tabela.
    await supabase.from("memories").insert({
      source_conversation_id: conversationId,
      kind: item.tipo,
      content: item.conteudo,
      confidence: item.confianca,
      embedding,
    });
  }
}
