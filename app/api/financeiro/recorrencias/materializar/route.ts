import { NextResponse, type NextRequest } from "next/server";

import { finContext } from "@/lib/financeiro/context";
import { materializar } from "@/lib/financeiro/recorrencias";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Gera as despesas do mês a partir das recorrências ativas. Idempotente.
// Body: { competencia?: "AAAA-MM" } (default = mês corrente).
export async function POST(req: NextRequest) {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  try {
    const body = await req.json().catch(() => ({}));
    const competencia =
      typeof body.competencia === "string" && /^\d{4}-\d{2}$/.test(body.competencia)
        ? body.competencia
        : new Date().toISOString().slice(0, 7);
    return NextResponse.json(await materializar(gate.companyId, competencia));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
