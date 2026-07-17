import { NextResponse, type NextRequest } from "next/server";

import { finContext } from "@/lib/financeiro/context";
import { checarDuplicatas } from "@/lib/financeiro/despesas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Candidatos a duplicata de uma nova despesa manual (mesma categoria/valor/venc).
// Gated por `financeiro`. `?categoria_id=&valor=&vencimento=AAAA-MM-DD`.
export async function GET(req: NextRequest) {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const sp = req.nextUrl.searchParams;
  const categoria_id = sp.get("categoria_id") ?? "";
  const valor = Number(sp.get("valor") ?? "");
  const vencimento = sp.get("vencimento") ?? "";
  if (!categoria_id || !Number.isFinite(valor) || !/^\d{4}-\d{2}-\d{2}$/.test(vencimento))
    return NextResponse.json({ candidatos: [] });

  try {
    const candidatos = await checarDuplicatas(gate.companyId, {
      categoria_id,
      valor_total: valor,
      data_vencimento: vencimento,
    });
    return NextResponse.json({ candidatos });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
