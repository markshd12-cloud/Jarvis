import { NextResponse, type NextRequest } from "next/server";

import { finContext } from "@/lib/financeiro/context";
import {
  atualizarDespesa,
  excluirDespesa,
  getDespesa,
} from "@/lib/financeiro/despesas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Detalhe da despesa (com todas as parcelas) — p/ o dialog de edição.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { id } = await params;
  const despesa = await getDespesa(gate.companyId, id);
  if (!despesa) return NextResponse.json({ error: "não encontrada" }, { status: 404 });
  return NextResponse.json({ despesa });
}

// Edita a despesa + substitui o parcelamento (re-valida Σ = total).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { id } = await params;
  try {
    return NextResponse.json(await atualizarDespesa(gate.companyId, id, await req.json()));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

// Exclui a despesa inteira (parcelas caem por cascade).
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { id } = await params;
  try {
    await excluirDespesa(gate.companyId, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
