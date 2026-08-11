import { NextResponse, type NextRequest } from "next/server";

import { getSessionContext } from "@/lib/db/permissions";
import { aquecerCaches } from "@/lib/marketing/aquecer";
import { can } from "@/lib/permissions";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Aquece os caches de leitura do Marketing (Graph, GA4, YouTube Analytics).
 *
 * - **Cron**: header `x-cron-secret` == `CRON_SECRET`.
 * - **Manual**: usuário com `marketing:gerenciar` (útil para testar).
 *
 * # Por que é um endpoint SEPARADO do `/sync`
 *
 * São operações opostas: o sync **escreve** no nosso banco, o aquecimento **lê**
 * das APIs externas. Juntá-los faria uma falha do Instagram abortar o
 * aquecimento do GA4 — coisas sem relação alguma derrubando uma à outra.
 *
 * # Rodar DEPOIS do sync
 *
 * Aquecer antes guardaria o dado velho por 6h: o cache seria preenchido com o
 * que existia antes da sincronização. No cron da VPS, a ordem é
 * `sync` → `aquecer`.
 */
export async function POST(req: NextRequest) {
  const isCron =
    !!process.env.CRON_SECRET &&
    req.headers.get("x-cron-secret") === process.env.CRON_SECRET;

  if (!isCron) {
    const ctx = await getSessionContext();
    if (!ctx.userId) return new Response("Unauthorized", { status: 401 });
    if (!can(ctx, "marketing", "gerenciar"))
      return new Response("Sem permissão", { status: 403 });
  }

  const r = await aquecerCaches();

  /**
   * 200 mesmo com item falhando, e o detalhe no corpo.
   *
   * Devolver 5xx faria o cron marcar a execução inteira como erro porque o GA4
   * está fora — e o GA4 está fora desde 29/07. Alarme que toca todo dia vira
   * ruído: quem precisa saber o que falhou lê `itens`.
   */
  return NextResponse.json({
    ok: r.itens.every((i) => i.ok),
    totalMs: r.totalMs,
    itens: r.itens,
  });
}
