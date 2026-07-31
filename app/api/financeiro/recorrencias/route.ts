import { NextResponse, type NextRequest } from "next/server";

import { invalidateDre } from "@/lib/contaazul/dre";
import { finContext } from "@/lib/financeiro/context";
import {
  createRecorrencia,
  listRecorrencias,
  materializar,
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
    // Materializa o mês corrente NA HORA: recorrência criada já aparece em
    // Contas a Pagar (e no DRE), sem depender do clique mensal/cron. Idempotente
    // (pula quem já tem despesa no mês); falha aqui não desfaz a criação.
    let materializado: { gerados: number; pulados: number } | null = null;
    try {
      const m = await materializar(
        gate.companyId,
        new Date().toISOString().slice(0, 7),
      );
      materializado = { gerados: m.gerados, pulados: m.pulados };
      if (m.gerados > 0) invalidateDre(gate.companyId);
    } catch {
      /* melhor-esforço — o cron/botão cobre depois */
    }
    return NextResponse.json({ recorrencia, materializado }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
