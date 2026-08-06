import { NextResponse, type NextRequest } from "next/server";

import { getSessionContext } from "@/lib/db/permissions";
import { trocarCodigo } from "@/lib/marketing/youtube-oauth";
import { can } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function volta(req: NextRequest, estado: string) {
  const res = NextResponse.redirect(
    new URL(`/marketing?aba=youtube&youtube=${estado}`, req.nextUrl.origin),
  );
  res.cookies.delete("youtube_oauth_state");
  return res;
}

/**
 * Retorno do consentimento do Google. Troca o `code` por tokens, descobre QUAL
 * canal foi autorizado e grava uma linha por canal.
 *
 * Por que descobrir o canal aqui: o token vem escopado ao canal que o usuário
 * escolheu na tela de consentimento, mas o Google não diz qual é na resposta do
 * token. Sem consultar `channels?mine=true`, gravaríamos um token sem saber a
 * que canal pertence — e com dois canais (CPPEM e Colégio) seria impossível
 * saber qual foi conectado.
 */
export async function GET(req: NextRequest) {
  const ctx = await getSessionContext();
  if (!ctx.userId)
    return NextResponse.redirect(new URL("/login", req.nextUrl.origin));
  if (!can(ctx, "marketing", "gerenciar")) return volta(req, "sem-permissao");

  const url = req.nextUrl;
  if (url.searchParams.get("error")) return volta(req, "negado");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get("youtube_oauth_state")?.value;
  if (!code) return volta(req, "erro");
  if (!state || !cookieState || state !== cookieState) return volta(req, "state-invalido");

  try {
    const token = await trocarCodigo(code);

    // Qual canal o usuário autorizou.
    const r = await fetch(
      "https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true",
      { headers: { Authorization: `Bearer ${token.access_token}` } },
    );
    const j = (await r.json()) as {
      items?: { id: string; snippet?: { title?: string } }[];
    };
    const canal = j.items?.[0];
    if (!canal?.id) return volta(req, "sem-canal");

    const admin = createAdminClient();
    const { error } = await admin.from("youtube_connections").upsert(
      {
        channel_id: canal.id,
        channel_title: canal.snippet?.title ?? null,
        access_token: token.access_token,
        // Numa REautorização o Google pode omitir o refresh_token. Não
        // sobrescrevemos com null: perder o refresh mataria a renovação e a
        // conexão duraria só 1 hora.
        ...(token.refresh_token ? { refresh_token: token.refresh_token } : {}),
        token_type: token.token_type ?? null,
        expires_at: token.expires_in
          ? new Date(Date.now() + token.expires_in * 1000).toISOString()
          : null,
        scope: token.scope ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "channel_id" },
    );
    if (error) throw new Error(error.message);

    return volta(req, "conectado");
  } catch (e) {
    console.error("[youtube] callback falhou", e);
    return volta(req, "erro");
  }
}
