import { NextResponse, type NextRequest } from "next/server";

import { invalidateDre } from "@/lib/contaazul/dre";
import { finContext } from "@/lib/financeiro/context";
import {
  createRecorrencia,
  listRecorrencias,
  materializarHorizonte,
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
    /**
     * Gera o ANO INTEIRO na hora. Uma despesa parcelada em 12x já nasce com as
     * 12 parcelas visíveis nos meses futuros do DRE; a recorrência — que é ainda
     * mais certa — aparecia só no mês corrente. O horizonte iguala as duas.
     * Idempotente; falha aqui não desfaz a criação (o cron cobre depois).
     */
    let materializado: { gerados: number; pulados: number; meses: number } | null = null;
    try {
      const m = await materializarHorizonte(gate.companyId);
      materializado = {
        gerados: m.gerados,
        pulados: m.pulados,
        meses: m.competencias.length,
      };
      if (m.gerados > 0) invalidateDre(gate.companyId);
    } catch {
      /* melhor-esforço — o cron cobre depois */
    }
    return NextResponse.json({ recorrencia, materializado }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
