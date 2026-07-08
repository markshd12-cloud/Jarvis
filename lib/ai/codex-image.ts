import { getValidAccessToken, oauthConfig } from "@/lib/ai/codex-auth";
import { parseSSE } from "@/lib/ai/codex";

/**
 * Geração de imagem pelo GPT via login OAuth do ChatGPT (SEM API key), usando a
 * ferramenta nativa `image_generation` da Responses API — mesmo token/endpoint
 * do texto (ver `lib/ai/codex.ts`).
 *
 * ⚠️ INCERTO: o backend Codex é focado em código; pode NÃO expor image_generation.
 * Por isso o chamador (`lib/ai/image.ts`) trata falha aqui como sinal para cair
 * no Imagen/Vertex. Config por env: OPENAI_CODEX_IMAGE_MODEL / _SIZE.
 */

export interface CodexImageResult {
  bytes: Uint8Array;
  mediaType: string;
}

export async function generateImageViaCodex(
  prompt: string,
  opts?: { signal?: AbortSignal },
): Promise<CodexImageResult> {
  const url = process.env.OPENAI_CODEX_RESPONSES_URL;
  if (!url) throw new Error("OPENAI_CODEX_RESPONSES_URL não configurado.");

  const { accessToken, accountId } = await getValidAccessToken();
  const cfg = oauthConfig();
  const model = process.env.OPENAI_CODEX_IMAGE_MODEL?.trim() || "gpt-5.5";
  const size = process.env.OPENAI_CODEX_IMAGE_SIZE?.trim() || "1024x1024";

  const body = {
    model,
    instructions:
      "Gere exatamente UMA imagem para o pedido do usuário usando a ferramenta " +
      "image_generation. Não responda com texto.",
    input: [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: prompt }],
      },
    ],
    tools: [{ type: "image_generation", size }],
    store: false,
    // O backend Codex EXIGE stream:true (senão HTTP 400 "Stream must be set to true").
    stream: true,
  };

  const res = await fetch(url, {
    method: "POST",
    signal: opts?.signal,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "OpenAI-Beta": "responses=experimental",
      originator: cfg.originator,
      "chatgpt-account-id": accountId,
      session_id: crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Codex image HTTP ${res.status}: ${detail.slice(0, 400)}`.trim(),
    );
  }

  // A imagem chega no stream: renders parciais (`partial_image_b64`) e/ou o item
  // final `image_generation_call.result` (base64 PNG). Guardamos o melhor.
  let result = "";
  let lastPartial = "";
  for await (const evt of parseSSE(res.body)) {
    const type = evt.type as string | undefined;
    if (type === "response.image_generation_call.partial_image") {
      if (typeof evt.partial_image_b64 === "string") {
        lastPartial = evt.partial_image_b64;
      }
    } else if (type === "response.output_item.done") {
      const item = evt.item as { type?: string; result?: string } | undefined;
      if (item?.type === "image_generation_call" && item.result) {
        result = item.result;
      }
    } else if (type === "response.completed") {
      const out = (
        evt.response as
          | { output?: Array<{ type?: string; result?: string }> }
          | undefined
      )?.output?.find((o) => o.type === "image_generation_call" && o.result);
      if (out?.result) result = out.result;
    } else if (type === "response.failed" || type === "error") {
      const detail =
        (evt.response as { error?: { message?: string } } | undefined)?.error
          ?.message ?? JSON.stringify(evt).slice(0, 300);
      throw new Error(`Codex image falhou: ${detail}`);
    }
  }

  const b64 = result || lastPartial;
  if (!b64) {
    throw new Error("Codex não retornou imagem (image_generation ausente).");
  }
  return {
    bytes: new Uint8Array(Buffer.from(b64, "base64")),
    mediaType: "image/png",
  };
}
