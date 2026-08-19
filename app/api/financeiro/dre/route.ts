import { NextResponse, type NextRequest } from "next/server";

import { type DreRegime } from "@/lib/contaazul/dre";
import { getDrePeriodo } from "@/lib/contaazul/dre-periodo";
import { competenciasEntre, EH_COMPETENCIA } from "@/lib/financeiro/exportar/tipos";
import { getCompanyId } from "@/lib/db/company";
import { mesCorrente } from "@/lib/financeiro/competencia";
import { getSessionContext } from "@/lib/db/permissions";
import { can } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Um ano inteiro são 12 leituras encadeadas; a frio isso passa do padrão de
 * 60s. Com o cache do `getDre` quente a resposta volta a ser imediata.
 */
export const maxDuration = 300;

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

  /**
   * Período: `?de=&ate=` (AAAA-MM). Sem eles, cai no mês único de sempre via
   * `?competencia=` — o contrato antigo continua valendo para quem já chama.
   */
  const raw = req.nextUrl.searchParams.get("competencia") ?? "";
  const competencia = EH_COMPETENCIA.test(raw) ? raw : mesCorrente();
  const de = req.nextUrl.searchParams.get("de") ?? "";
  const ate = req.nextUrl.searchParams.get("ate") ?? "";
  const comps =
    EH_COMPETENCIA.test(de) && EH_COMPETENCIA.test(ate)
      ? competenciasEntre(de, ate)
      : [];
  const periodo = comps.length ? comps : [competencia];

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

  const dre = await getDrePeriodo(companyId, periodo, buId, regime);
  return NextResponse.json(dre);
}
