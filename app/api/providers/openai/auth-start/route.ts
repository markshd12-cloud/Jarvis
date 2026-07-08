import { NextResponse } from "next/server";

import { oauthConfig } from "@/lib/ai/codex-auth";
import {
  canManageConexoes,
  generatePkce,
  PKCE_COOKIE,
  STATE_COOKIE,
  FLOW_COOKIE_MAX_AGE,
} from "@/lib/ai/codex-oauth";

export const runtime = "nodejs";

// Browser OAuth (PKCE): gera a URL de autorização e guarda verifier+state em
// cookies httpOnly. O usuário loga no navegador e cola a URL de callback em
// /auth-complete.
export async function POST() {
  if (!(await canManageConexoes())) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  let cfg;
  try {
    cfg = oauthConfig();
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }

  const { verifier, challenge, state } = generatePkce();

  const params = new URLSearchParams({
    response_type: "code",
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    scope: cfg.scopes,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
  });

  const res = NextResponse.json({
    authorize_url: `${cfg.authorizeUrl}?${params.toString()}`,
  });
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: FLOW_COOKIE_MAX_AGE,
  };
  res.cookies.set(PKCE_COOKIE, verifier, cookieOpts);
  res.cookies.set(STATE_COOKIE, state, cookieOpts);
  return res;
}
