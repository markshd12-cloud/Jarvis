import { NextResponse, type NextRequest } from "next/server";

import { finContext } from "@/lib/financeiro/context";
import { reconciliarDespesa } from "@/lib/financeiro/reconciliacao";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Reconciliação de despesa (CA × Jarvis) na competência. Portão antes do cutover.
// Gated por `financeiro`. `?competencia=AAAA-MM` (default: mês corrente).
export async function GET(req: NextRequest) {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const raw = req.nextUrl.searchParams.get("competencia") ?? "";
  const competencia = /^\d{4}-\d{2}$/.test(raw) ? raw : new Date().toISOString().slice(0, 7);

  return NextResponse.json(await reconciliarDespesa(gate.companyId, competencia));
}
