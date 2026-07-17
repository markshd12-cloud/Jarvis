import { NextResponse, type NextRequest } from "next/server";

import { finContext } from "@/lib/financeiro/context";
import { baixarParcela, desfazerBaixa } from "@/lib/financeiro/despesas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Baixa/desfaz o pagamento de uma parcela. Body: { acao: 'baixar'|'desfazer', ... }.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { id } = await params;
  try {
    const { acao, valor_realizado, data_pagamento } = await req.json();
    if (acao === "baixar")
      await baixarParcela(gate.companyId, id, { valor_realizado, data_pagamento });
    else if (acao === "desfazer") await desfazerBaixa(gate.companyId, id);
    else return NextResponse.json({ error: "ação inválida" }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
