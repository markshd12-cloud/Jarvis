import { NextResponse, type NextRequest } from "next/server";

import { invalidateDre } from "@/lib/contaazul/dre";
import { mesCorrente } from "@/lib/financeiro/competencia";
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
    // Materializa NA HORA para a recorrência já aparecer em Contas a Pagar (e no
    // DRE), sem depender do clique mensal/cron. A competência é a MAIOR entre o
    // mês corrente e o INÍCIO: com início no futuro (ex.: criada dia 31 com
    // vencimento dia 5 → início = mês seguinte), gerar só o mês corrente não
    // produziria nada e a recorrência "sumiria" — então geramos o mês de início,
    // que é uma dívida futura legítima (visível pelo filtro de competência).
    // Idempotente; falha aqui não desfaz a criação.
    let materializado: { competencia: string; gerados: number; pulados: number } | null = null;
    try {
      const inicio = recorrencia.inicio_competencia;
      const atual = mesCorrente();
      const comp = inicio && inicio > atual ? inicio : atual;
      const m = await materializar(gate.companyId, comp);
      materializado = { competencia: comp, gerados: m.gerados, pulados: m.pulados };
      if (m.gerados > 0) invalidateDre(gate.companyId);
    } catch {
      /* melhor-esforço — o cron/botão cobre depois */
    }
    return NextResponse.json({ recorrencia, materializado }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
