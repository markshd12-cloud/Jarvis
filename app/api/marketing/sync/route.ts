import { NextResponse, type NextRequest } from "next/server";

import { getSessionContext } from "@/lib/db/permissions";
import { syncMeta } from "@/lib/marketing/meta";
import { can } from "@/lib/permissions";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Sync do Meta Ads. GLOBAL (sem empresa): uma execução cobre as 4 contas.
 * - Cron: header `x-cron-secret` == CRON_SECRET.
 * - Manual: usuário autenticado com permissão `marketing:gerenciar`.
 */
export async function POST(req: NextRequest) {
  const cronSecret = req.headers.get("x-cron-secret");
  const isCron =
    !!process.env.CRON_SECRET && cronSecret === process.env.CRON_SECRET;

  if (!isCron) {
    const ctx = await getSessionContext();
    if (!ctx.userId) return new Response("Unauthorized", { status: 401 });
    if (!can(ctx, "marketing", "gerenciar"))
      return new Response("Sem permissão", { status: 403 });
  }

  // Backfill manual opcional: POST /api/marketing/sync?days=90 amplia a janela
  // (o sync normal usa o lookback padrão). Ignorado se ausente/inválido.
  const daysParam = Number(req.nextUrl.searchParams.get("days"));
  const lookbackDays =
    Number.isFinite(daysParam) && daysParam > 0 ? daysParam : undefined;

  try {
    const result = await syncMeta({ lookbackDays });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[marketing] sync Meta falhou", error);
    return new Response("Falha ao sincronizar", { status: 500 });
  }
}
