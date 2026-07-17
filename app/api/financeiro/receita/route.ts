import { NextResponse } from "next/server";

import { finContext } from "@/lib/financeiro/context";
import { resumoReceita } from "@/lib/financeiro/receita";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Resumo do snapshot de receita por competência. Gated por `financeiro`.
export async function GET() {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  return NextResponse.json(await resumoReceita(gate.companyId));
}
