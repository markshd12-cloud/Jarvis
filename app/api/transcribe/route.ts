import { generateText } from "ai";

import { chatModel } from "@/lib/ai/vertex";
import { createClient } from "@/lib/supabase/server";

// google-auth-library exige o runtime Node.
export const runtime = "nodejs";

// ~2min de áudio em WAV 16kHz mono (base64 tem overhead de ~33%).
const MAX_AUDIO_BASE64_CHARS = 3_000_000;

/**
 * Transcreve áudio gravado no navegador via Gemini (multimodal nativo) —
 * o texto resultante entra no fluxo normal do chat, respondido pelo Claude.
 * Ver decisão em memória: Gemini só transcreve, nunca responde diretamente.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { audio, mediaType }: { audio?: string; mediaType?: string } =
    await req.json();
  if (!audio) {
    return Response.json({ error: "Áudio ausente" }, { status: 400 });
  }
  if (audio.length > MAX_AUDIO_BASE64_CHARS) {
    return Response.json({ error: "Áudio muito longo" }, { status: 413 });
  }

  try {
    const { text } = await generateText({
      model: chatModel,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Transcreva o áudio a seguir em Português do Brasil. Responda " +
                "APENAS com a transcrição literal da fala, sem comentários e sem " +
                "aspas. Se não houver fala compreensível, responda com uma string vazia.",
            },
            { type: "file", data: audio, mediaType: mediaType ?? "audio/wav" },
          ],
        },
      ],
    });
    return Response.json({ text: text.trim() });
  } catch (error) {
    console.error("[transcribe] falhou:", error);
    return Response.json(
      { error: "Falha ao transcrever o áudio" },
      { status: 500 },
    );
  }
}
