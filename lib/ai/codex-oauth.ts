import { createHash, randomBytes } from "node:crypto";

import { getSessionContext } from "@/lib/db/permissions";
import { can } from "@/lib/permissions";

/**
 * Helpers do fluxo OAuth do ChatGPT (Browser PKCE + Device) usados pelas rotas
 * em `app/api/providers/openai/*`. Porta do evo-nexus adaptada ao App Router:
 * o estado efêmero (code_verifier, state, device_auth_id) vai em cookies
 * httpOnly de curta duração em vez da session do Flask.
 */

export const PKCE_COOKIE = "codex_pkce_verifier";
export const STATE_COOKIE = "codex_oauth_state";
export const DEVICE_COOKIE = "codex_device_auth";

/** TTL dos cookies de fluxo (10 min cobre o login interativo). */
export const FLOW_COOKIE_MAX_AGE = 600;

const b64url = (buf: Buffer) =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Gera o par PKCE (S256) + um state anti-CSRF. */
export function generatePkce(): {
  verifier: string;
  challenge: string;
  state: string;
} {
  const verifier = b64url(randomBytes(64));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(32));
  return { verifier, challenge, state };
}

/**
 * Conectar/desconectar o ChatGPT é gerir uma CONEXÃO da empresa (como o Notion).
 * Exige `conhecimento:gerenciar` (ou superadmin). Retorna se pode + o userId.
 */
export async function canManageConexoes(): Promise<boolean> {
  const ctx = await getSessionContext();
  if (!ctx.userId) return false;
  return can(ctx, "conhecimento", "gerenciar");
}
