import { NextResponse, type NextRequest } from "next/server";

import { getSessionContext } from "@/lib/db/permissions";
import { urlDeAutorizacao, youtubeConfigurado } from "@/lib/marketing/youtube-oauth";
import { can } from "@/lib/permissions";

export const runtime = "nodejs";

/** Volta para o Marketing com um recado na URL. */
function volta(req: NextRequest, estado: string) {
  return NextResponse.redirect(
    new URL(`/marketing?aba=youtube&youtube=${estado}`, req.nextUrl.origin),
  );
}

/**
 * Inicia o OAuth do dono do canal (YouTube Nível B).
 *
 * Exige `marketing:gerenciar` — conectar um canal é ato de gestão, e o token
 * resultante dá acesso a receita. Ler o painel (`marketing`) não basta.
 */
export async function GET(req: NextRequest) {
  const ctx = await getSessionContext();
  if (!ctx.userId)
    return NextResponse.redirect(new URL("/login", req.nextUrl.origin));
  if (!can(ctx, "marketing", "gerenciar")) return volta(req, "sem-permissao");
  if (!youtubeConfigurado()) return volta(req, "sem-credencial");

  // Anti-CSRF: state aleatório em cookie httpOnly, conferido no callback.
  const state = crypto.randomUUID();
  const res = NextResponse.redirect(urlDeAutorizacao(state));
  res.cookies.set("youtube_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
