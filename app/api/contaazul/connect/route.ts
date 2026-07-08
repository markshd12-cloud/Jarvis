import { NextResponse, type NextRequest } from "next/server";

import { CONTA_AZUL_ENV, CONTA_AZUL_OAUTH } from "@/lib/contaazul/config";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Inicia o OAuth 2.0 da Conta Azul (exige usuário autenticado).
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (!CONTA_AZUL_ENV.clientId || !CONTA_AZUL_ENV.redirectUri) {
    // Credenciais ainda não configuradas no .env.local.
    return NextResponse.redirect(new URL("/dashboard?contaazul=config", req.url));
  }

  // Anti-CSRF: state aleatório guardado em cookie httpOnly e validado no callback.
  const state = crypto.randomUUID();

  const params = new URLSearchParams({
    client_id: CONTA_AZUL_ENV.clientId,
    redirect_uri: CONTA_AZUL_ENV.redirectUri,
    response_type: "code",
    scope: CONTA_AZUL_OAUTH.scope,
    state,
  });

  const res = NextResponse.redirect(
    `${CONTA_AZUL_OAUTH.authorizeUrl}?${params.toString()}`,
  );
  res.cookies.set("contaazul_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
