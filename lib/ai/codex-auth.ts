import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Gestão do login do ChatGPT (OAuth, SEM API key) — porta do padrão do
 * evo-nexus (`dashboard/backend/routes/providers.py`), adaptada para HTTP direto.
 *
 * Em vez de spawnar o `openclaude` CLI, o Jarvis fala DIRETO com o backend Codex
 * do ChatGPT (ver `lib/ai/codex.ts`). Este módulo cuida só do TOKEN: lê, grava e
 * faz refresh do `~/.codex/auth.json` — o mesmo arquivo que o Codex CLI usa.
 *
 * Nenhum token encosta em `.env` ou banco: vive apenas em `~/.codex/auth.json`.
 * Todas as URLs/IDs de OAuth vêm de `process.env` (`OPENAI_OAUTH_*`).
 */

/** Caminho do auth.json, respeitando CODEX_HOME e o override CODEX_AUTH_JSON_PATH. */
export function codexAuthPath(): string {
  if (process.env.CODEX_AUTH_JSON_PATH) return process.env.CODEX_AUTH_JSON_PATH;
  const home = process.env.CODEX_HOME || join(homedir(), ".codex");
  return join(home, "auth.json");
}

/** Tokens da sessão OAuth do ChatGPT. */
export interface CodexTokens {
  access_token: string;
  refresh_token: string;
  id_token: string;
  account_id: string;
}

/** Config de OAuth do ChatGPT. */
interface OAuthConfig {
  clientId: string;
  authorizeUrl: string;
  tokenUrl: string;
  deviceCodeUrl: string;
  redirectUri: string;
  scopes: string;
  originator: string;
}

/**
 * Constantes FIXAS do login do Codex CLI. NÃO são configuráveis: o client
 * `app_EMoamEEZ...` é o client oficial do Codex e a OpenAI só aceita o redirect
 * `http://localhost:1455/auth/callback` para ele. Valores vindos do ambiente
 * (ex.: um redirect da Vercel de outra integração) QUEBRAM o fluxo — a OpenAI
 * ignora o redirect e devolve o usuário ao chatgpt.com. Por isso NÃO lemos essas
 * URLs do env; só `originator` (cosmético) permanece sobrescrevível.
 */
const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token";
const CODEX_DEVICE_CODE_URL = "https://auth.openai.com/oauth/device/code";
const CODEX_REDIRECT_URI = "http://localhost:1455/auth/callback";
const CODEX_SCOPES = "openid profile email offline_access";

export function oauthConfig(): OAuthConfig {
  return {
    clientId: CODEX_CLIENT_ID,
    authorizeUrl: CODEX_AUTHORIZE_URL,
    tokenUrl: CODEX_TOKEN_URL,
    deviceCodeUrl: CODEX_DEVICE_CODE_URL,
    redirectUri: CODEX_REDIRECT_URI,
    scopes: CODEX_SCOPES,
    originator: process.env.OPENAI_OAUTH_ORIGINATOR?.trim() || "codex_cli_rs",
  };
}

/** Decodifica o payload de um JWT (sem verificar assinatura — só leitura de claims). */
function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

/** Extrai o chatgpt_account_id de dentro do access_token (claim custom da OpenAI). */
function accountIdFromToken(accessToken: string): string {
  const payload = decodeJwt(accessToken);
  const auth = payload?.["https://api.openai.com/auth"] as
    | { chatgpt_account_id?: string }
    | undefined;
  return auth?.chatgpt_account_id ?? "";
}

/** Instante (ms) de expiração do access_token via claim `exp`, ou null se ausente. */
function tokenExpiryMs(accessToken: string): number | null {
  const exp = decodeJwt(accessToken)?.exp;
  return typeof exp === "number" ? exp * 1000 : null;
}

/**
 * Lê o auth.json. Aceita tanto o formato do Codex CLI
 * (`{ OPENAI_API_KEY, tokens, last_refresh }`) quanto o do evo-nexus/OpenClaude
 * (`{ auth_mode, tokens, last_refresh }`). Retorna null se não houver login.
 */
export async function readCodexAuth(): Promise<CodexTokens | null> {
  let raw: string;
  try {
    raw = await readFile(codexAuthPath(), "utf8");
  } catch {
    return null;
  }
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const tokens = (data.tokens ?? {}) as Partial<CodexTokens>;
  const access_token = tokens.access_token;
  if (!access_token) return null;
  return {
    access_token,
    refresh_token: tokens.refresh_token ?? "",
    id_token: tokens.id_token ?? access_token,
    account_id: tokens.account_id || accountIdFromToken(access_token),
  };
}

/**
 * Grava os tokens no auth.json, no formato que o Codex CLI entende (e com o
 * `auth_mode` do OpenClaude, por compatibilidade). Deriva o account_id do JWT
 * quando o provedor não o devolve explicitamente.
 */
export async function writeCodexAuth(raw: {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  account_id?: string;
}): Promise<CodexTokens> {
  const tokens: CodexTokens = {
    access_token: raw.access_token,
    refresh_token: raw.refresh_token ?? "",
    id_token: raw.id_token ?? raw.access_token,
    account_id: raw.account_id || accountIdFromToken(raw.access_token),
  };
  const path = codexAuthPath();
  await mkdir(join(path, ".."), { recursive: true });
  // Formato compatível com o codex CLI oficial: { OPENAI_API_KEY, tokens,
  // last_refresh }. NÃO gravamos `auth_mode` — o codex CLI atual rejeita
  // `"Chatgpt"` (espera `chatgpt` minúsculo) e infere ChatGPT pela ausência de
  // API key + presença de tokens. Nosso código lê `tokens.access_token` direto.
  await writeFile(
    path,
    JSON.stringify(
      {
        OPENAI_API_KEY: null,
        tokens,
        last_refresh: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );
  return tokens;
}

/** Remove o auth.json (logout). Idempotente. */
export async function clearCodexAuth(): Promise<void> {
  await rm(codexAuthPath(), { force: true });
}

/**
 * Troca um refresh_token por tokens novos (grant_type=refresh_token) e persiste.
 * Lança se o refresh falhar (ex.: refresh_token revogado → precisa relogar).
 */
export async function refreshCodexToken(
  refreshToken: string,
): Promise<CodexTokens> {
  const cfg = oauthConfig();
  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: cfg.clientId,
      scope: cfg.scopes,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Falha ao renovar o token do ChatGPT (HTTP ${res.status}). ` +
        "Reconecte a conta.",
    );
  }
  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
  };
  return writeCodexAuth({
    access_token: data.access_token,
    // Alguns provedores rotacionam o refresh_token; se não vier, mantém o atual.
    refresh_token: data.refresh_token ?? refreshToken,
    id_token: data.id_token,
  });
}

/** Margem antes do `exp` para renovar proativamente (evita corrida na borda). */
const REFRESH_SKEW_MS = 5 * 60_000;

/**
 * Retorna um access_token VÁLIDO (renovando se estiver perto de expirar) junto
 * do account_id. Lança se não houver login ou se o refresh falhar.
 */
export async function getValidAccessToken(): Promise<{
  accessToken: string;
  accountId: string;
}> {
  let auth = await readCodexAuth();
  if (!auth) {
    throw new CodexAuthError("ChatGPT não conectado. Faça o login OAuth.");
  }
  const expiry = tokenExpiryMs(auth.access_token);
  const expiringSoon = expiry !== null && expiry - Date.now() < REFRESH_SKEW_MS;
  if (expiringSoon && auth.refresh_token) {
    auth = await refreshCodexToken(auth.refresh_token);
  }
  return { accessToken: auth.access_token, accountId: auth.account_id };
}

/** Status do login para a UI (nunca expõe o token em si). */
export async function codexAuthStatus(): Promise<{
  connected: boolean;
  accountId?: string;
  expiresAt?: string | null;
}> {
  const auth = await readCodexAuth();
  if (!auth) return { connected: false };
  const expiry = tokenExpiryMs(auth.access_token);
  return {
    connected: true,
    accountId: auth.account_id || undefined,
    expiresAt: expiry ? new Date(expiry).toISOString() : null,
  };
}

/** Erro específico de "não logado" — o chat pode cair no fallback ao vê-lo. */
export class CodexAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexAuthError";
  }
}
