import { NextResponse, type NextRequest } from "next/server";

import { invalidateDre } from "@/lib/contaazul/dre";
import { finContext } from "@/lib/financeiro/context";
import { importarDespesas } from "@/lib/financeiro/import-despesas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Importa despesas do Conta Azul p/ fin_despesas/fin_parcelas (insert-only, dedup
// por ca_evento_id). Gated por `financeiro`. Body: { meses?: number } (default 12).
export async function POST(req: NextRequest) {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const body = await req.json().catch(() => ({}));
  const meses =
    typeof body.meses === "number" && body.meses > 0 && body.meses <= 48 ? body.meses : 12;

  try {
    const res = await importarDespesas(gate.companyId, meses);
    if (res.novos > 0) invalidateDre(gate.companyId); // competências cortadas mudaram
    return NextResponse.json(res);
  } catch (e) {
    // Sempre devolve JSON — senão o front quebra com "Unexpected end of JSON input".
    return NextResponse.json(
      { connected: false, erro: (e as Error).message },
      { status: 500 },
    );
  }
}
