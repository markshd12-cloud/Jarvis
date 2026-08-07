import { NextResponse, type NextRequest } from "next/server";

import { removerBaixa } from "@/lib/financeiro/baixas";
import { finContext } from "@/lib/financeiro/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Remove UMA baixa e recalcula a parcela.
 *
 * Rota própria (e não `parcelas/[id]/baixas/[baixaId]`) porque a baixa já sabe a
 * que parcela pertence — exigir os dois ids no caminho abriria espaço para o
 * cliente mandar um par inconsistente.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { id } = await params;
  try {
    await removerBaixa(gate.companyId, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
