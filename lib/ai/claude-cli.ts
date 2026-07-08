import { spawn, execSync } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CLAUDE_MODEL } from "@/lib/ai/provider";

/**
 * Bridge do Claude como IA PRINCIPAL — porta do padrão do evo-nexus.
 *
 * Em vez de chamar a API HTTP da Anthropic (que exigiria ANTHROPIC_API_KEY),
 * dirigimos o **binário do Claude Code CLI** por subprocess em modo `--print`
 * (não-interativo, saída `stream-json`). Quando o CLI NÃO encontra
 * ANTHROPIC_API_KEY no ambiente, ele cai automaticamente nas credenciais do
 * `claude login` (token OAuth da conta Pro/Max, em ~/.claude/.credentials.json).
 *
 * O segredo, portanto, é montar um ambiente LIMPO (whitelist) onde a API key
 * nunca existe — assim o CLI é forçado a usar a sessão logada.
 */

const isWindows = process.platform === "win32";

/**
 * Whitelist de variáveis de sistema herdadas pelo processo do CLI.
 * NÃO espalhamos `process.env` inteiro: uma ANTHROPIC_API_KEY que porventura
 * exista no ambiente do servidor nunca vaza para o CLI. Mantemos apenas o que
 * o binário precisa para rodar e para achar ~/.claude (USERPROFILE/HOME e,
 * se o usuário customizou, CLAUDE_CONFIG_DIR).
 */
const SYSTEM_VARS = [
  // POSIX
  "HOME",
  "USER",
  "SHELL",
  "PATH",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LOGNAME",
  "TMPDIR",
  "SSH_AUTH_SOCK",
  // Windows
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "SystemRoot",
  "SystemDrive",
  "windir",
  "ComSpec",
  "PATHEXT",
  "TEMP",
  "TMP",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  // Onde ficam as credenciais OAuth, se o usuário customizou o caminho.
  "CLAUDE_CONFIG_DIR",
] as const;

function buildCleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of SYSTEM_VARS) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  // Blindagem explícita: nenhuma credencial de API pode sobrescrever o OAuth.
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  env.TERM = "dumb";
  return env;
}

/** Resolve o caminho do binário `claude` (cache por processo). */
let cachedClaudePath: string | null = null;
function resolveClaudeCommand(): string {
  if (cachedClaudePath) return cachedClaudePath;
  try {
    const cmd = isWindows ? "where claude" : "command -v claude";
    const found = execSync(cmd, { encoding: "utf8" })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    // No Windows preferimos o shim .cmd (executável via shell).
    cachedClaudePath =
      found.find((p) => p.toLowerCase().endsWith(".cmd")) ??
      found[0] ??
      "claude";
  } catch {
    cachedClaudePath = "claude";
  }
  return cachedClaudePath;
}

/** Aspas apenas no Windows (shell:true não faz quoting automático). */
const winQuote = (s: string) => (isWindows ? `"${s}"` : s);

/**
 * Ferramentas agênticas desligadas: queremos um chat de texto puro, não um
 * agente mexendo em arquivos/rede. (Belt-and-suspenders: no modo --print sem
 * --dangerously-skip-permissions elas já seriam negadas.)
 */
const DISALLOWED_TOOLS = [
  "Bash",
  "Read",
  "Write",
  "Edit",
  "NotebookEdit",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "Task",
  "TodoWrite",
];

// Extensões de arquivo por mídia (imagens que o Claude lê via Read).
const IMAGE_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** Imagem anexada a ser gravada no workspace para o Claude ler. */
export interface ClaudeImage {
  mediaType: string;
  /** Data URL (`data:image/png;base64,...`). */
  dataUrl: string;
}

/**
 * Chunk emitido pelo stream: texto da resposta ou uma atualização de status
 * (ex.: "Lendo o anexo…") para o feedback ao vivo na UI.
 */
export type ClaudeChunk =
  | { type: "text"; delta: string }
  | { type: "status"; label: string };

export class ClaudeCliError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "ClaudeCliError";
  }
}

export interface StreamClaudeOptions {
  /** Prompt de sistema (persona Jarvis + contexto RAG). */
  system: string;
  /** Prompt do usuário / transcrição da conversa (vai por stdin). */
  prompt: string;
  /** Modelo (alias ou nome). Default: CLAUDE_MODEL. */
  model?: string;
  /** Imagens anexadas — gravadas no workspace e lidas via ferramenta Read. */
  images?: ClaudeImage[];
  /** Aborta o subprocess (ex.: cliente desconectou). */
  signal?: AbortSignal;
  /** Timeout total em ms. Default 120s. */
  timeoutMs?: number;
}

/**
 * Executa o Claude via CLI e emite os deltas de TEXTO da resposta conforme
 * chegam. Lança `ClaudeCliError` se o processo falhar ANTES de produzir texto
 * (o chamador pode então cair no fallback do Gemini).
 */
export async function* streamClaudeText(
  opts: StreamClaudeOptions,
): AsyncGenerator<ClaudeChunk> {
  const model = opts.model ?? CLAUDE_MODEL;
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const images = opts.images ?? [];

  // cwd isolado (dir temporário vazio): sem CLAUDE.md/repo para o CLI explorar.
  const cwd = await mkdtemp(join(tmpdir(), "jarvis-claude-"));
  const systemFile = join(cwd, "system.txt");
  await writeFile(systemFile, opts.system, "utf8");

  // Grava as imagens no workspace com nomes seguros (sem input do usuário no
  // nome → sem path traversal) e instrui o modelo a lê-las.
  let prompt = opts.prompt;
  if (images.length) {
    const names: string[] = [];
    for (let i = 0; i < images.length; i++) {
      const ext = IMAGE_EXT[images[i].mediaType.toLowerCase()] ?? "png";
      const fname = `anexo-${i + 1}.${ext}`;
      const base64 = images[i].dataUrl.replace(/^data:[^,]*,/, "");
      await writeFile(join(cwd, fname), Buffer.from(base64, "base64"));
      names.push(fname);
    }
    prompt =
      `${opts.prompt}\n\n[Imagens anexadas nesta pasta: ${names.join(", ")}. ` +
      `Use a ferramenta Read para visualizá-las antes de responder.]`;
  }

  const args = [
    "--print",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    // Isola MCP: ignora TODOS os servidores MCP globais do usuário
    // (Google Drive/Notion/n8n) — não queremos essas ferramentas no chat.
    "--strict-mcp-config",
    // Isola settings do usuário (CLAUDE.md/skills/regras de permissão): garante
    // que só as flags abaixo governam ferramentas — essencial p/ a via imagem.
    "--setting-sources",
    winQuote(""),
    "--model",
    model,
    "--system-prompt-file",
    winQuote(systemFile),
    // Com imagem: libera SÓ Read confinado ao workspace (Read(./**)) — testado:
    // lê a imagem local mas NEGA arquivos fora da pasta (sem bypass). Sem
    // imagem: chat de texto puro, todas as ferramentas desligadas.
    ...(images.length
      ? ["--allowedTools", winQuote("Read(./**)")]
      : ["--disallowed-tools", ...DISALLOWED_TOOLS]),
  ];

  const command = resolveClaudeCommand();
  const child = spawn(isWindows ? winQuote(command) : command, args, {
    cwd,
    // NODE_ENV do Next augmenta ProcessEnv com um union estrito; o cast evita
    // conflito com nosso env de whitelist (Record<string,string>).
    env: buildCleanEnv() as unknown as NodeJS.ProcessEnv,
    shell: isWindows, // .cmd só executa via shell no Windows
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });

  // --- Ponte readline → fila assíncrona -----------------------------------
  const queue: string[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  let spawnError: Error | null = null;
  let stderr = "";
  let resultText: string | null = null;
  let resultIsError = false;
  let exitCode: number | null = null;
  let yieldedText = false;

  const notify = () => {
    wake?.();
    wake = null;
  };

  const rl = createInterface({ input: child.stdout! });
  rl.on("line", (line) => {
    queue.push(line);
    notify();
  });
  rl.on("close", () => {
    closed = true;
    notify();
  });
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  child.on("error", (err) => {
    spawnError = err;
    closed = true;
    notify();
  });
  child.on("exit", (code) => {
    exitCode = code ?? null;
  });

  const timer = setTimeout(() => {
    spawnError = new Error(`Claude CLI excedeu ${timeoutMs}ms`);
    try {
      child.kill("SIGKILL");
    } catch {
      /* noop */
    }
  }, timeoutMs);

  const onAbort = () => {
    try {
      child.kill("SIGKILL");
    } catch {
      /* noop */
    }
  };
  opts.signal?.addEventListener("abort", onAbort, { once: true });

  // Alimenta o prompt do usuário por stdin e fecha.
  child.stdin!.write(prompt, "utf8");
  child.stdin!.end();

  try {
    // Feedback imediato quando há imagem (o Read leva alguns segundos).
    if (images.length) {
      yield { type: "status", label: "Analisando a imagem…" };
    }

    while (true) {
      if (queue.length === 0) {
        if (closed) break;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        continue;
      }
      const line = queue.shift()!;
      if (!line.trim()) continue;

      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line);
      } catch {
        continue; // linha não-JSON (ruído) — ignora
      }

      // Deltas de texto em tempo real + status de uso de ferramenta.
      if (event.type === "stream_event") {
        const inner = event.event as
          | {
              type?: string;
              delta?: { type?: string; text?: string };
              content_block?: { type?: string; name?: string };
            }
          | undefined;
        // Início de uso de ferramenta (ex.: Read na imagem) → status na UI.
        if (
          inner?.type === "content_block_start" &&
          inner.content_block?.type === "tool_use"
        ) {
          const name = inner.content_block.name;
          yield {
            type: "status",
            label: name === "Read" ? "Lendo o anexo…" : "Consultando…",
          };
          continue;
        }
        if (
          inner?.type === "content_block_delta" &&
          inner.delta?.type === "text_delta" &&
          inner.delta.text
        ) {
          yieldedText = true;
          yield { type: "text", delta: inner.delta.text };
        }
        continue;
      }

      // Status geral: aguardando a API responder.
      if (
        event.type === "system" &&
        event.subtype === "status" &&
        event.status === "requesting" &&
        !yieldedText
      ) {
        yield { type: "status", label: "Pensando…" };
        continue;
      }

      // Evento final: guarda texto completo e status de erro.
      if (event.type === "result") {
        resultIsError = event.is_error === true;
        if (typeof event.result === "string") resultText = event.result;
      }
    }

    // Cast defeat da narrowing por CFA (spawnError é mutado só em callbacks).
    const failure = spawnError as Error | null;
    if (failure) {
      throw new ClaudeCliError(
        "Falha ao executar o Claude CLI",
        `${failure.message}\n${stderr}`.trim(),
      );
    }

    // Sem streaming de deltas (ex.: partial desligado) mas com texto final:
    // entrega o texto completo de uma vez.
    if (!yieldedText && resultText) {
      yield { type: "text", delta: resultText };
      yieldedText = true;
    }

    if (!yieldedText) {
      const reason = resultIsError
        ? "Claude retornou erro (possível limite de uso/rate limit da conta)"
        : `Claude CLI terminou sem resposta (exit ${exitCode ?? "?"})`;
      throw new ClaudeCliError(reason, stderr.trim() || undefined);
    }
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
    rl.close();
    try {
      child.kill();
    } catch {
      /* já saiu */
    }
    void rm(cwd, { recursive: true, force: true }).catch(() => {});
  }
}
