import { NextResponse, type NextRequest } from "next/server";

import { finContext } from "@/lib/financeiro/context";
import { sugerirOrcamento } from "@/lib/financeiro/orcamentos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sugestão de previsão (Passo 9): média mensal do custo dos últimos N meses.
// GET ?competencia=AAAA-MM&meses=3
export async function GET(req: NextRequest) {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const competencia = req.nextUrl.searchParams.get("competencia") ?? "";
  const meses = Number(req.nextUrl.searchParams.get("meses") ?? "3");
  try {
    return NextResponse.json(
      await sugerirOrcamento(gate.companyId, competencia, meses),
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
