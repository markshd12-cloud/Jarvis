import { NextResponse, type NextRequest } from "next/server";

import { resumoClientes } from "@/lib/financeiro/clientes";
import { finContext } from "@/lib/financeiro/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Clientes (LTV, em aberto, situação) compostos do Conta Azul. Gated por `financeiro`.
// ?fresh=1 fura o cache de 10 min.
export async function GET(req: NextRequest) {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const force = req.nextUrl.searchParams.get("fresh") === "1";
  return NextResponse.json(await resumoClientes(gate.companyId, { force }));
}
