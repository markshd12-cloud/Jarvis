import { NextResponse, type NextRequest } from "next/server";

import { finContext } from "@/lib/financeiro/context";
import {
  deleteColaborador,
  setColaboradorAtivo,
  updateColaborador,
} from "@/lib/financeiro/colaboradores";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Atualiza (campos) e/ou ativa/inativa (`{ ativo }`) um colaborador.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { id } = await params;
  try {
    const { ativo, ...campos } = await req.json();
    if (typeof ativo === "boolean") await setColaboradorAtivo(gate.companyId, id, ativo);
    const colaborador =
      Object.keys(campos).length > 0
        ? await updateColaborador(gate.companyId, id, campos)
        : null;
    return NextResponse.json({ ok: true, colaborador });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { id } = await params;
  try {
    await deleteColaborador(gate.companyId, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 409 });
  }
}
