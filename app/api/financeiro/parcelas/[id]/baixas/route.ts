import { NextResponse, type NextRequest } from "next/server";

import {
  encerrarEnvelope,
  lancarBaixa,
  listarBaixas,
  reabrirEnvelope,
} from "@/lib/financeiro/baixas";
import { finContext } from "@/lib/financeiro/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Baixas parciais de uma parcela ("despesa-envelope").
 *
 * Gate: `financeiro`, o mesmo da baixa cheia — lançar gasto num envelope é a
 * mesma responsabilidade de dar baixa numa conta. Ver
 * docs/financeiro-baixas-parciais.md.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { id } = await params;
  try {
    return NextResponse.json({ baixas: await listarBaixas(gate.companyId, id) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

/**
 * Body:
 *   { acao: 'lancar', valor, descricao?, data?, competencia?, metodo_pagamento? }
 *   { acao: 'encerrar', motivo }
 *   { acao: 'reabrir' }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { id } = await params;
  try {
    const body = await req.json();
    const acao = body?.acao ?? "lancar";

    if (acao === "encerrar") {
      await encerrarEnvelope(gate.companyId, id, String(body?.motivo ?? ""));
    } else if (acao === "reabrir") {
      await reabrirEnvelope(gate.companyId, id);
    } else if (acao === "lancar") {
      await lancarBaixa(gate.companyId, id, {
        valor: Number(body?.valor),
        descricao: body?.descricao ?? null,
        data: body?.data ?? undefined,
        competencia: body?.competencia ?? undefined,
        metodo_pagamento: body?.metodo_pagamento ?? null,
        observacao: body?.observacao ?? null,
      });
    } else {
      return NextResponse.json({ error: "ação inválida" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
