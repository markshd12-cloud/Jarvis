import { NextResponse, type NextRequest } from "next/server";

import {
  createColaborador,
  listColaboradores,
  listMembers,
} from "@/lib/financeiro/colaboradores";
import { finContext } from "@/lib/financeiro/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Colaboradores & fornecedores. Gated por `financeiro` (dados sensíveis: pix/conta).
export async function GET() {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const [colaboradores, members] = await Promise.all([
    listColaboradores(gate.companyId),
    listMembers(gate.companyId),
  ]);
  return NextResponse.json({ colaboradores, members });
}

export async function POST(req: NextRequest) {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  try {
    const colaborador = await createColaborador(gate.companyId, await req.json());
    return NextResponse.json({ colaborador }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
