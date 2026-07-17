import { NextResponse, type NextRequest } from "next/server";

import { finContext } from "@/lib/financeiro/context";
import {
  getFluxoCaixa,
  type FluxoIncluir,
  type FluxoModo,
} from "@/lib/financeiro/fluxo-caixa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Fluxo de Caixa (Passo 13), regime de caixa. Gated por `financeiro`.
// GET ?modo=mensal|diario &ano=AAAA (mensal) &mes=AAAA-MM (diário)
//     &bu=<uuid|''> &incluir=ambos|previsto|realizado
export async function GET(req: NextRequest) {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const sp = req.nextUrl.searchParams;
  try {
    const data = await getFluxoCaixa(gate.companyId, {
      modo: (sp.get("modo") as FluxoModo) ?? "mensal",
      ano: sp.get("ano") ? Number(sp.get("ano")) : undefined,
      mes: sp.get("mes") ?? undefined,
      buId: sp.get("bu") || null,
      incluir: (sp.get("incluir") as FluxoIncluir) ?? "ambos",
    });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
