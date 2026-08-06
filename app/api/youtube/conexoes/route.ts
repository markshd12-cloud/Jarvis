import { NextResponse, type NextRequest } from "next/server";

import { getSessionContext } from "@/lib/db/permissions";
import { desconectar, listarConexoes } from "@/lib/marketing/youtube-oauth";
import { can } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Canais conectados (sem devolver token algum ao cliente). */
export async function GET() {
  const ctx = await getSessionContext();
  if (!can(ctx, "marketing"))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const canais = await listarConexoes();
  return NextResponse.json({
    canais: canais.map((c) => ({
      channelId: c.channel_id,
      titulo: c.channel_title,
      temRefresh: !!c.refresh_token,
      expiraEm: c.expires_at,
    })),
  });
}

export async function DELETE(req: NextRequest) {
  const ctx = await getSessionContext();
  if (!can(ctx, "marketing", "gerenciar"))
    return NextResponse.json({ error: "sem permissão" }, { status: 403 });
  const channelId = req.nextUrl.searchParams.get("channelId") ?? "";
  if (!channelId)
    return NextResponse.json({ error: "channelId obrigatório" }, { status: 400 });
  await desconectar(channelId);
  return NextResponse.json({ ok: true });
}
