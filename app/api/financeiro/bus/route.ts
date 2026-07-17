import { NextResponse, type NextRequest } from "next/server";

import { createBu, listBus } from "@/lib/financeiro/bus";
import { finContext } from "@/lib/financeiro/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Business Units da empresa. Gated por `financeiro`.
export async function GET() {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  return NextResponse.json({ bus: await listBus(gate.companyId) });
}

export async function POST(req: NextRequest) {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  try {
    const bu = await createBu(gate.companyId, await req.json());
    return NextResponse.json({ bu }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
