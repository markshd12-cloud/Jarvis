import { NextResponse, type NextRequest } from "next/server";

import { finContext } from "@/lib/financeiro/context";
import { resumoVendas } from "@/lib/financeiro/vendas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Vendas & Contas a Faturar (faturado × a faturar) do ano, lido do Conta Azul.
// Gated por `financeiro`. Query: ?ano=2026 · ?fresh=1 fura o cache de 5 min.
export async function GET(req: NextRequest) {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const sp = req.nextUrl.searchParams;
  const ano = Number(sp.get("ano")) || undefined;
  const force = sp.get("fresh") === "1";
  return NextResponse.json(await resumoVendas(gate.companyId, { ano, force }));
}
