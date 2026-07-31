import { NextResponse, type NextRequest } from "next/server";

import { invalidateDre } from "@/lib/contaazul/dre";
import { finContext } from "@/lib/financeiro/context";
import {
  criarDespesa,
  listParcelas,
  type FiltrosParcela,
} from "@/lib/financeiro/despesas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Contas a Pagar: lista de parcelas (com filtros) e criação de despesa parcelada.
export async function GET(req: NextRequest) {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const p = req.nextUrl.searchParams;
  const filtros: FiltrosParcela = {
    grupo: (p.get("grupo") as FiltrosParcela["grupo"]) ?? undefined,
    bu_id: p.get("bu_id") ?? undefined,
    categoria_id: p.get("categoria_id") ?? undefined,
    centro_custo_id: p.get("centro_custo_id") ?? undefined,
    busca: p.get("busca") ?? undefined,
    de: p.get("de") ?? undefined,
    ate: p.get("ate") ?? undefined,
  };
  return NextResponse.json({ parcelas: await listParcelas(gate.companyId, filtros) });
}

export async function POST(req: NextRequest) {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  try {
    const res = await criarDespesa(gate.companyId, await req.json());
    invalidateDre(gate.companyId); // pós-cutover o DRE lê nossas parcelas — reflete na hora
    return NextResponse.json(res, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
