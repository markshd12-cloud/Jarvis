import { NextResponse, type NextRequest } from "next/server";

import { getDre } from "@/lib/contaazul/dre";
import { getCompanyId } from "@/lib/db/company";
import { getSessionContext } from "@/lib/db/permissions";
import { can } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DRE da empresa por competência. Gated por `financeiro`. `?competencia=AAAA-MM`.
export async function GET(req: NextRequest) {
  const ctx = await getSessionContext();
  if (!can(ctx, "financeiro"))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const companyId = await getCompanyId();
  if (!companyId)
    return NextResponse.json({
      connected: false,
      competencia: "",
      receitaBruta: 0,
      rows: [],
      semMapeamento: 0,
    });

  const raw = req.nextUrl.searchParams.get("competencia") ?? "";
  const competencia = /^\d{4}-\d{2}$/.test(raw)
    ? raw
    : new Date().toISOString().slice(0, 7);

  const dre = await getDre(companyId, competencia);
  return NextResponse.json(dre);
}
