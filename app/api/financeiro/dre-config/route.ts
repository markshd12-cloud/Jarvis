import { NextResponse, type NextRequest } from "next/server";

import { invalidateDre } from "@/lib/contaazul/dre";
import { finContext } from "@/lib/financeiro/context";
import { getDreConfig, setCutover } from "@/lib/financeiro/dre-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Config do DRE v2 (cutover da despesa). Gated por `financeiro`.
export async function GET() {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  return NextResponse.json(await getDreConfig(gate.companyId));
}

// Define/limpa o cutover. Body: { competencia: "AAAA-MM" | null }.
export async function PUT(req: NextRequest) {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const body = await req.json().catch(() => ({}));
  const raw = body?.competencia;
  const competencia =
    raw == null || raw === "" ? null : typeof raw === "string" ? raw : undefined;
  if (competencia === undefined)
    return NextResponse.json({ error: "competencia inválida" }, { status: 400 });

  try {
    const cfg = await setCutover(gate.companyId, competencia);
    invalidateDre(gate.companyId); // a virada aparece na hora, sem esperar o TTL
    return NextResponse.json(cfg);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
