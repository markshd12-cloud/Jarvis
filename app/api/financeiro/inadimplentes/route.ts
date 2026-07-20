import { NextResponse, type NextRequest } from "next/server";

import { finContext } from "@/lib/financeiro/context";
import { listarInadimplentes } from "@/lib/financeiro/inadimplentes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Inadimplentes (contas a receber vencidas) agrupados por cliente. Gated por `financeiro`.
// `?fresh=1` fura o cache de 5 min e busca ao vivo (botão "Atualizar").
export async function GET(req: NextRequest) {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const force = req.nextUrl.searchParams.get("fresh") === "1";
  return NextResponse.json(await listarInadimplentes(gate.companyId, { force }));
}
