import { NextResponse, type NextRequest } from "next/server";

import { detalheDespesaPorCategoria, type DreRegime } from "@/lib/contaazul/dre";
import { finContext } from "@/lib/financeiro/context";
import { mesCorrente } from "@/lib/financeiro/competencia";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "De onde veio esse número": as parcelas que compõem UMA linha de despesa do
 * DRE. Gated por `financeiro`.
 *
 * Os parâmetros são de propósito os MESMOS da rota do DRE (`competencia`, `bu`,
 * `regime`), e são repassados intactos — é o que garante que a soma do detalhe
 * feche com a linha que o usuário clicou. Ler os dois de fontes diferentes daria
 * números diferentes na mesma tela.
 *
 * `caId` é o id da categoria financeira do Conta Azul (a chave das folhas do
 * DRE), não o id da categoria do Jarvis.
 */
export async function GET(req: NextRequest) {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const caId = req.nextUrl.searchParams.get("caId") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(caId))
    return NextResponse.json({ error: "caId inválido" }, { status: 400 });

  const raw = req.nextUrl.searchParams.get("competencia") ?? "";
  const competencia = /^\d{4}-\d{2}$/.test(raw) ? raw : mesCorrente();

  const buRaw = req.nextUrl.searchParams.get("bu") ?? "";
  const buId = buRaw === "sem" || /^[0-9a-f-]{36}$/i.test(buRaw) ? buRaw : null;

  const regime: DreRegime =
    req.nextUrl.searchParams.get("regime") === "previsto-realizado"
      ? "previsto-realizado"
      : "competencia";

  // ?pagas=1 → só o que foi liquidado. É o que o painel de Fechamento usa, para
  // a soma do detalhe fechar com a coluna Realizado da linha clicada.
  const somentePagas = req.nextUrl.searchParams.get("pagas") === "1";

  try {
    const r = await detalheDespesaPorCategoria(
      gate.companyId,
      caId,
      competencia,
      buId,
      regime,
      somentePagas,
    );
    return NextResponse.json({ ...r, competencia, regime, somentePagas });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
