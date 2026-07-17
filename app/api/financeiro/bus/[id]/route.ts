import { NextResponse, type NextRequest } from "next/server";

import { deleteBu, setBuAtivo, updateBu } from "@/lib/financeiro/bus";
import { finContext } from "@/lib/financeiro/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Atualiza uma BU (campos) e/ou ativa/inativa (`{ ativo }`). Nunca exclui.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { id } = await params;
  try {
    const { ativo, ...campos } = await req.json();
    if (typeof ativo === "boolean") await setBuAtivo(gate.companyId, id, ativo);
    const bu =
      Object.keys(campos).length > 0
        ? await updateBu(gate.companyId, id, campos)
        : null;
    return NextResponse.json({ ok: true, bu });
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
    await deleteBu(gate.companyId, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 409 });
  }
}
