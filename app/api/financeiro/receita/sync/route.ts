import { NextResponse, type NextRequest } from "next/server";

import { finContext } from "@/lib/financeiro/context";
import { sincronizarReceita } from "@/lib/financeiro/receita";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sincroniza a receita do Conta Azul no snapshot. Idempotente (upsert por evento).
// Body: { meses?: number } (janela de meses pra trás; default 12).
export async function POST(req: NextRequest) {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const body = await req.json().catch(() => ({}));
  const meses =
    typeof body.meses === "number" && body.meses > 0 && body.meses <= 48 ? body.meses : 12;
  return NextResponse.json(await sincronizarReceita(gate.companyId, meses));
}
