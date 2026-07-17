import { NextResponse, type NextRequest } from "next/server";

import { finContext } from "@/lib/financeiro/context";
import { createCentro, listCentros } from "@/lib/financeiro/centros";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Centros de custo da empresa. Gated por `financeiro`.
export async function GET() {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  return NextResponse.json({ centros: await listCentros(gate.companyId) });
}

export async function POST(req: NextRequest) {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  try {
    const centro = await createCentro(gate.companyId, await req.json());
    return NextResponse.json({ centro }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
