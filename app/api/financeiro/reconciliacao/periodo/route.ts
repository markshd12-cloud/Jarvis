import { NextResponse, type NextRequest } from "next/server";

import { finContext } from "@/lib/financeiro/context";
import { reconciliarPeriodo } from "@/lib/financeiro/reconciliacao";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Conferência CA × Jarvis de vários meses de uma vez (material p/ decidir o
// cutover). Gated por `financeiro`. `?meses=12` (1..24, default 12).
export async function GET(req: NextRequest) {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const n = Number(req.nextUrl.searchParams.get("meses"));
  const meses = Number.isFinite(n) && n >= 1 && n <= 24 ? Math.floor(n) : 12;

  try {
    return NextResponse.json(await reconciliarPeriodo(gate.companyId, meses));
  } catch (e) {
    return NextResponse.json(
      { connected: false, meses: [], totalCa: 0, totalJarvis: 0, erro: (e as Error).message },
      { status: 500 },
    );
  }
}
