import {
  getValidAccessToken,
  readCodexAuth,
  refreshCodexToken,
  oauthConfig,
  CodexAuthError,
} from "@/lib/ai/codex-auth";
import type { ClaudeChunk, ClaudeImage } from "@/lib/ai/claude-cli";

/**
 * Cliente do GPT via ChatGPT (login OAuth, SEM API key) — HTTP direto.
 *
 * Fala com o backend Codex do ChatGPT (endpoint `/responses`, mesmo que o Codex
 * CLI usa) autenticado pelo token OAuth de `~/.codex/auth.json`. É o análogo do
 * `streamClaudeText`, mas para o GPT: emite os mesmos `ClaudeChunk`
 * (`text` | `status`) para reaproveitar todo o streaming/persistência do chat.
 *
 * Nenhuma OPENAI_API_KEY é usada: a cobrança vai pela assinatura do ChatGPT.
 */

export class CodexError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "CodexError";
  }
}

/**
 * Modelo do Codex backend. Para conta ChatGPT, o backend só aceita modelos
 * específicos — `gpt-5.5` é o default do codex CLI atual e FUNCIONA (verificado
 * 2026-07-07). Os `*-codex` (gpt-5-codex, gpt-5.5-codex) são recusados p/ conta
 * ChatGPT ("model is not supported when using Codex with a ChatGPT account").
 */
export const CODEX_MODEL = process.env.OPENAI_CODEX_MODEL?.trim() || "gpt-5.5";

/** Esforço de raciocínio; "medium" equilibra qualidade e latência para chat. */
const REASONING_EFFORT = process.env.OPENAI_CODEX_REASONING?.trim() || "medium";

export interface StreamCodexOptions {
  /** Prompt de sistema (persona Jarvis + contexto RAG). */
  system: string;
  /** Prompt do usuário / transcrição da conversa. */
  prompt: string;
  /** Modelo (nome do backend Codex). Default: CODEX_MODEL. */
  model?: string;
  /** Imagens anexadas (data URLs) enviadas como input_image. */
  images?: ClaudeImage[];
  /** Aborta a requisição (ex.: cliente desconectou). */
  signal?: AbortSignal;
  /** Timeout total em ms. Default 120s. */
  timeoutMs?: number;
}

/** Monta o corpo da Responses API para um turno de chat. */
function buildBody(opts: StreamCodexOptions): Record<string, unknown> {
  const content: Array<Record<string, unknown>> = [
    { type: "input_text", text: opts.prompt },
  ];
  for (const img of opts.images ?? []) {
    content.push({ type: "input_image", image_url: img.dataUrl });
  }
  return {
    model: opts.model ?? CODEX_MODEL,
    instructions: opts.system,
    input: [{ type: "message", role: "user", content }],
    tools: [],
    tool_choice: "auto",
    parallel_tool_calls: false,
    reasoning: { effort: REASONING_EFFORT, summary: "auto" },
    store: false,
    stream: true,
    include: ["reasoning.encrypted_content"],
    prompt_cache_key: crypto.randomUUID(),
  };
}

/** Uma requisição ao endpoint /responses com o access_token informado. */
async function postResponses(
  accessToken: string,
  accountId: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<Response> {
  const url = process.env.OPENAI_CODEX_RESPONSES_URL;
  if (!url) {
    throw new CodexError(
      "OPENAI_CODEX_RESPONSES_URL não configurado no ambiente.",
    );
  }
  const cfg = oauthConfig();
  return fetch(url, {
    method: "POST",
    signal,
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
}

/**
 * Executa o GPT via backend Codex e emite os deltas de TEXTO conforme chegam.
 * Lança `CodexError`/`CodexAuthError` se falhar ANTES de produzir texto (o
 * chamador pode então cair no fallback do Gemini).
 */
export async function* streamCodexText(
  opts: StreamCodexOptions,
): AsyncGenerator<ClaudeChunk> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const body = buildBody(opts);

  // Timeout + abort do chamador combinados num único signal.
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const { accessToken, accountId } = await getValidAccessToken();

    let res = await postResponses(accessToken, accountId, body, controller.signal);

    // 401: token pode ter sido revogado/expirado na borda — tenta 1 refresh.
    if (res.status === 401) {
      const auth = await readCodexAuth();
      if (auth?.refresh_token) {
        const renewed = await refreshCodexToken(auth.refresh_token);
        res = await postResponses(
          renewed.access_token,
          renewed.account_id,
          body,
          controller.signal,
        );
      }
    }

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new CodexError(
        `Backend Codex retornou HTTP ${res.status}`,
        detail.slice(0, 2000) || undefined,
      );
    }

    let yieldedText = false;
    let sawReasoning = false;

    for await (const evt of parseSSE(res.body)) {
      const type = evt.type as string | undefined;

      // Texto visível da resposta.
      if (type === "response.output_text.delta") {
        const delta = evt.delta as string | undefined;
        if (delta) {
          yieldedText = true;
          yield { type: "text", delta };
        }
        continue;
      }

      // Raciocínio: vira status "Pensando…" enquanto ainda não há texto.
      if (
        type === "response.reasoning_summary_text.delta" ||
        type === "response.reasoning_text.delta"
      ) {
        if (!yieldedText && !sawReasoning) {
          sawReasoning = true;
          yield { type: "status", label: "Pensando…" };
        }
        continue;
      }

      // Erro reportado dentro do stream.
      if (type === "response.failed" || type === "error") {
        const err = extractError(evt);
        if (!yieldedText) {
          throw new CodexError("GPT retornou erro", err);
        }
        // Já emitiu texto: encerra sem trocar de motor.
        return;
      }

      if (type === "response.completed") break;
    }

    if (!yieldedText) {
      throw new CodexError("GPT terminou sem resposta.");
    }
  } catch (error) {
    if (error instanceof CodexError || error instanceof CodexAuthError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new CodexError("Requisição ao GPT abortada (timeout ou cancelada).");
    }
    throw new CodexError(
      "Falha ao chamar o GPT",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

/** Extrai mensagem de erro de um evento de falha da Responses API. */
function extractError(evt: Record<string, unknown>): string {
  const response = evt.response as { error?: { message?: string } } | undefined;
  const direct = evt.error as { message?: string } | string | undefined;
  if (typeof direct === "string") return direct;
  return (
    response?.error?.message ??
    direct?.message ??
    JSON.stringify(evt).slice(0, 500)
  );
}

/**
 * Parser de Server-Sent Events: quebra o stream em eventos (`\n\n`) e devolve o
 * JSON de cada linha `data:`. Ignora `data: [DONE]` e linhas não-JSON.
 * Exportado para reuso na geração de imagem (`codex-image.ts`).
 */
export async function* parseSSE(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<Record<string, unknown>> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep: number;
      // Um evento SSE termina em linha em branco (\n\n; tolera \r\n\r\n).
      while ((sep = indexOfSeparator(buffer)) !== -1) {
        const rawEvent = buffer.slice(0, sep);
        buffer = buffer.slice(sep).replace(/^(\r?\n){2}/, "");

        for (const line of rawEvent.split(/\r?\n/)) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            yield JSON.parse(payload) as Record<string, unknown>;
          } catch {
            /* linha data: não-JSON — ignora */
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Índice do separador de evento SSE (\n\n ou \r\n\r\n), ou -1. */
function indexOfSeparator(buf: string): number {
  const a = buf.indexOf("\n\n");
  const b = buf.indexOf("\r\n\r\n");
  if (a === -1) return b;
  if (b === -1) return a;
  return Math.min(a, b);
}
