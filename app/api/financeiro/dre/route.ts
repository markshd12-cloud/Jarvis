import { NextResponse, type NextRequest } from "next/server";

import { getDre, type DreRegime } from "@/lib/contaazul/dre";
import { getCompanyId } from "@/lib/db/company";
import { mesCorrente } from "@/lib/financeiro/competencia";
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
  const competencia = /^\d{4}-\d{2}$/.test(raw) ? raw : mesCorrente();

  // ?bu=<id> → DRE daquela BU; ?bu=sem → receita sem BU; vazio = Todas (consolidado).
  const buRaw = req.nextUrl.searchParams.get("bu") ?? "";
  const buId =
    buRaw === "sem" || /^[0-9a-f-]{36}$/i.test(buRaw) ? buRaw : null;

  // ?regime=previsto-realizado → agrupa pelo VENCIMENTO (as contas do mês).
  // Ausente/qualquer outro valor → competência (o custo do mês). Ver DreRegime.
  const regime: DreRegime =
    req.nextUrl.searchParams.get("regime") === "previsto-realizado"
      ? "previsto-realizado"
      : "competencia";

  const dre = await getDre(companyId, competencia, buId, regime);
  return NextResponse.json(dre);
}
