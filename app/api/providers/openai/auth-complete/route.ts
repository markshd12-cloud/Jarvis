import { NextResponse, type NextRequest } from "next/server";

import { oauthConfig, writeCodexAuth } from "@/lib/ai/codex-auth";
import {
  canManageConexoes,
  PKCE_COOKIE,
  STATE_COOKIE,
} from "@/lib/ai/codex-oauth";

export const runtime = "nodejs";

// Recebe a URL de callback colada pelo usuário, extrai o code, valida o state
// e troca por tokens (grant_type=authorization_code + PKCE), gravando o auth.json.
export async function POST(req: NextRequest) {
  if (!(await canManageConexoes())) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const { callback_url } = (await req.json().catch(() => ({}))) as {
    callback_url?: string;
  };
  if (!callback_url) {
    return NextResponse.json(
      { error: "Cole a URL de callback do login." },
      { status: 400 },
    );
  }

  let code: string | null;
  let state: string | null;
  try {
    const parsed = new URL(callback_url);
    code = parsed.searchParams.get("code");
    state = parsed.searchParams.get("state");
  } catch {
    return NextResponse.json({ error: "URL inválida." }, { status: 400 });
  }
  if (!code) {
    return NextResponse.json(
      { error: "URL inválida — não contém código de autorização." },
      { status: 400 },
    );
  }

  // Anti-CSRF: o state da URL precisa bater com o cookie.
  const cookieState = req.cookies.get(STATE_COOKIE)?.value;
  if (!state || !cookieState || state !== cookieState) {
    return NextResponse.json(
      { error: "Sessão de login inválida — recomece o login." },
      { status: 400 },
    );
  }

  const verifier = req.cookies.get(PKCE_COOKIE)?.value;
  if (!verifier) {
    return NextResponse.json(
      { error: "Sessão expirada — inicie o login novamente." },
      { status: 400 },
    );
  }

  const cfg = oauthConfig();
  const tokenRes = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: cfg.redirectUri,
      client_id: cfg.clientId,
      code_verifier: verifier,
    }),
  });

  if (!tokenRes.ok) {
    return NextResponse.json(
      { error: `Falha na troca de token (HTTP ${tokenRes.status}).` },
      { status: 400 },
    );
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
  };
  await writeCodexAuth(tokens);

  const res = NextResponse.json({
    status: "ok",
    message: "ChatGPT conectado com sucesso!",
  });
  res.cookies.delete(PKCE_COOKIE);
  res.cookies.delete(STATE_COOKIE);
  return res;
}
