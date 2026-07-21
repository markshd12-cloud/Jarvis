import { NextResponse, type NextRequest } from "next/server";

import { finContext } from "@/lib/financeiro/context";
import { getPainel } from "@/lib/financeiro/painel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Dashboard TV (visão executiva do ano). Gated por `financeiro`. ?fresh=1 fura o cache.
export async function GET(req: NextRequest) {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const force = req.nextUrl.searchParams.get("fresh") === "1";
  return NextResponse.json(await getPainel(gate.companyId, { force }));
}
