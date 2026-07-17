import { NextResponse, type NextRequest } from "next/server";

import { finContext } from "@/lib/financeiro/context";
import { deleteCentro, setCentroAtivo, updateCentro } from "@/lib/financeiro/centros";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Atualiza um centro de custo (campos) e/ou ativa/inativa (`{ ativo }`). Nunca exclui.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { id } = await params;
  try {
    const { ativo, ...campos } = await req.json();
    if (typeof ativo === "boolean") await setCentroAtivo(gate.companyId, id, ativo);
    const centro =
      Object.keys(campos).length > 0
        ? await updateCentro(gate.companyId, id, campos)
        : null;
    return NextResponse.json({ ok: true, centro });
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
    await deleteCentro(gate.companyId, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 409 });
  }
}
