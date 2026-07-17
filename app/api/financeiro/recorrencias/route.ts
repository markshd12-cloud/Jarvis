import { NextResponse, type NextRequest } from "next/server";

import { finContext } from "@/lib/financeiro/context";
import {
  createRecorrencia,
  listRecorrencias,
} from "@/lib/financeiro/recorrencias";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Recorrências (despesas fixas). Gated por `financeiro`.
export async function GET() {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  return NextResponse.json({ recorrencias: await listRecorrencias(gate.companyId) });
}

export async function POST(req: NextRequest) {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  try {
    const recorrencia = await createRecorrencia(gate.companyId, await req.json());
    return NextResponse.json({ recorrencia }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
