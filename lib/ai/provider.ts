/**
 * Seleção do provider de IA "principal" do Jarvis.
 *
 * O padrão é **Claude** (via CLI + sessão OAuth, ver `lib/ai/claude-cli.ts`).
 * O **codex** fala com o GPT via login OAuth do ChatGPT, SEM API key, direto no
 * backend Codex (ver `lib/ai/codex.ts`). O Gemini/Vertex (`lib/ai/vertex.ts`)
 * permanece como FALLBACK do chat e é o motor de embeddings + destilação de
 * memórias (nenhum dos CLIs/HTTP faz isso).
 *
 * Configurável por env (sem código):
 *   JARVIS_DEFAULT_PROVIDER = claude | codex | gemini   (vazio → claude)
 *   CLAUDE_MODEL            = alias/nome do modelo do Claude (vazio → "sonnet")
 *   OPENAI_CODEX_MODEL      = modelo do backend Codex (vazio → "gpt-5-codex")
 */
export type Provider = "claude" | "codex" | "gemini";

function pickProvider(): Provider {
  switch (process.env.JARVIS_DEFAULT_PROVIDER?.trim().toLowerCase()) {
    case "gemini":
      return "gemini";
    case "codex":
    case "gpt":
    case "openai":
      return "codex";
    default:
      return "claude";
  }
}

export const PRINCIPAL_PROVIDER: Provider = pickProvider();

/**
 * Modelo do Claude usado no chat. Aceita alias ("sonnet", "opus", "haiku")
 * ou o nome completo (ex.: "claude-sonnet-4-5"). Alias é resolvido pelo CLI
 * para o modelo mais recente da família.
 */
export const CLAUDE_MODEL = process.env.CLAUDE_MODEL?.trim() || "sonnet";
