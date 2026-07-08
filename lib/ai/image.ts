import { generateImage } from "ai";

import { readCodexAuth } from "@/lib/ai/codex-auth";
import { generateImageViaCodex } from "@/lib/ai/codex-image";
import { createAdminClient } from "@/lib/supabase/admin";

import { vertex } from "./vertex";

// Imagen no Vertex — reusa a MESMA service account do Gemini/embeddings (sem
// chave nova). Modelo sobrescrevível por env; "fast" é mais barato/rápido.
const IMAGEN_MODEL = process.env.IMAGEN_MODEL ?? "imagen-4.0-fast-generate-001";
const BUCKET = "generated-images";

const EXT_BY_MEDIA: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

let bucketReady = false;

/** Garante o bucket público (idempotente). */
async function ensureBucket(admin: ReturnType<typeof createAdminClient>) {
  if (bucketReady) return;
  const { error } = await admin.storage.createBucket(BUCKET, { public: true });
  // "already exists" é esperado nas próximas vezes — só isso é ignorável.
  if (error && !/exist/i.test(error.message)) throw new Error(error.message);
  bucketReady = true;
}

export interface GeneratedImage {
  url: string;
  mediaType: string;
  /** Qual motor gerou a imagem — útil para log/diagnóstico. */
  source: "gpt" | "imagen";
}

interface ImageBytes {
  bytes: Uint8Array;
  mediaType: string;
  source: "gpt" | "imagen";
}

/**
 * Gera os bytes da imagem. Padrão = **Imagen/Vertex** (rápido, sem API key).
 *
 * O **GPT (via OAuth do ChatGPT, sem API key)** é usado quando:
 *  - o pedido pediu GPT explicitamente (`preferGpt`, palavra-chave no chat), OU
 *  - `JARVIS_IMAGE_PROVIDER=gpt` (torna o GPT o padrão global).
 * Em ambos os casos só tenta se houver login do ChatGPT; qualquer falha cai
 * graciosamente no Imagen. Obs.: GPT-imagem leva ~47s vs Imagen (~segundos).
 */
async function generateImageBytes(
  prompt: string,
  preferGpt = false,
): Promise<ImageBytes> {
  const gptIsDefault =
    process.env.JARVIS_IMAGE_PROVIDER?.trim().toLowerCase() === "gpt";
  if ((preferGpt || gptIsDefault) && (await readCodexAuth()) !== null) {
    try {
      const { bytes, mediaType } = await generateImageViaCodex(prompt);
      return { bytes, mediaType, source: "gpt" };
    } catch (error) {
      console.warn(
        "[image] GPT (Codex) não gerou a imagem, usando Imagen como fallback:",
        (error as Error).message,
      );
    }
  }

  const { image } = await generateImage({
    model: vertex.image(IMAGEN_MODEL),
    prompt,
    aspectRatio: "1:1",
  });
  return {
    bytes: image.uint8Array,
    mediaType: image.mediaType,
    source: "imagen",
  };
}

/**
 * Gera uma imagem (GPT principal → Imagen fallback) e a hospeda no Supabase
 * Storage, devolvendo a URL pública (persistível como markdown `![](url)` —
 * sobrevive ao reload). Escopo por empresa/conversa no caminho do arquivo.
 */
export async function generateAndStoreImage(
  prompt: string,
  opts: {
    companyId?: string | null;
    conversationId: string;
    /** Preferir o GPT (via OAuth) para esta imagem específica. */
    preferGpt?: boolean;
  },
): Promise<GeneratedImage> {
  const { bytes, mediaType, source } = await generateImageBytes(
    prompt,
    opts.preferGpt,
  );

  const admin = createAdminClient();
  await ensureBucket(admin);

  const ext = EXT_BY_MEDIA[mediaType] ?? "png";
  const path = `${opts.companyId ?? "sem-empresa"}/${opts.conversationId}/${crypto.randomUUID()}.${ext}`;

  const { error } = await admin.storage.from(BUCKET).upload(path, bytes, {
    contentType: mediaType,
    upsert: true,
  });
  if (error) throw new Error(error.message);

  const { data } = admin.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, mediaType, source };
}
