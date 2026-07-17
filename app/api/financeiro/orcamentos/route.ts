import { NextResponse, type NextRequest } from "next/server";

import { finContext } from "@/lib/financeiro/context";
import {
  getOrcamentoComparativo,
  saveOrcamento,
} from "@/lib/financeiro/orcamentos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Orçamento & Limite (Passo 9). Gated por `financeiro`.
// GET ?competencia=AAAA-MM → comparativo Orçado × Previsto × Realizado × Limite.
export async function GET(req: NextRequest) {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const competencia = req.nextUrl.searchParams.get("competencia") ?? "";
  try {
    return NextResponse.json({
      linhas: await getOrcamentoComparativo(gate.companyId, competencia),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

// POST → cria/atualiza a meta de (categoria, bu, competência).
export async function POST(req: NextRequest) {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  try {
    const orcamento = await saveOrcamento(gate.companyId, await req.json());
    return NextResponse.json({ orcamento }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
