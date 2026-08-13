import { NextResponse, type NextRequest } from "next/server";

import type { DreRegime } from "@/lib/contaazul/dre";
import { getCompanyId } from "@/lib/db/company";
import { getSessionContext } from "@/lib/db/permissions";
import { nomeArquivo, paraCsv } from "@/lib/financeiro/exportar/csv";
import { extrairContasPagar, type FormatoRateio } from "@/lib/financeiro/exportar/fontes/contas-pagar";
import { extrairDre } from "@/lib/financeiro/exportar/fontes/dre";
import {
  EH_COMPETENCIA,
  TETO_MESES,
  competenciasEntre,
  mesCorrenteSP,
  type Extracao,
} from "@/lib/financeiro/exportar/tipos";
import { can } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Extração longa (DRE de 24 competências) pode passar do padrão de 60s. */
export const maxDuration = 300;

/**
 * Exportação do Financeiro em CSV.
 *
 * Dois modos, de propósito:
 *
 * - `?preview=1` → **JSON** com contagem, totais e avisos. É o que o botão usa
 *   ANTES de baixar, para a pessoa ver "0 linhas" ou o aviso de mês sem receita
 *   e decidir. Sem isso, a única forma de descobrir que a extração está vazia é
 *   abrir o arquivo.
 * - sem `preview` → o **arquivo**, com `Content-Disposition: attachment`.
 *
 * Gated por `financeiro`, como a rota do DRE. Ver `docs/financeiro-exportacao.md`.
 */
export async function GET(req: NextRequest) {
  const ctx = await getSessionContext();
  if (!can(ctx, "financeiro"))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const companyId = await getCompanyId();
  if (!companyId)
    return NextResponse.json({ error: "sem empresa" }, { status: 400 });

  const q = req.nextUrl.searchParams;
  const fonte = q.get("fonte") ?? "";
  const mes = mesCorrenteSP();
  const de = EH_COMPETENCIA.test(q.get("de") ?? "") ? (q.get("de") as string) : mes;
  const ate = EH_COMPETENCIA.test(q.get("ate") ?? "") ? (q.get("ate") as string) : de;

  /**
   * Teto de meses: recorta em vez de recusar.
   *
   * Recusar obrigaria a pessoa a adivinhar o limite. Recortando, ela recebe o
   * arquivo e o aviso de que foi recortado — e escolhe se refaz em pedaços.
   */
  const comps = competenciasEntre(de, ate);
  const ateReal = comps.length ? comps[comps.length - 1] : ate;
  const recortou = comps.length === TETO_MESES && ateReal !== ate;

  const buRaw = q.get("bu") ?? "";
  const buId = buRaw === "sem" || /^[0-9a-f-]{36}$/i.test(buRaw) ? buRaw : null;
  const buNome = q.get("buNome") ?? undefined;

  let extracao: Extracao;
  try {
    if (fonte === "contas-pagar") {
      extracao = await extrairContasPagar(companyId, {
        de,
        ate: ateReal,
        formatoRateio: (q.get("rateio") as FormatoRateio) === "por-bu" ? "por-bu" : "resumido",
        buId: buId ?? undefined,
      });
    } else if (fonte === "dre") {
      extracao = await extrairDre(companyId, {
        de,
        ate: ateReal,
        regime: (q.get("regime") as DreRegime) === "competencia" ? "competencia" : "previsto-realizado",
        buId,
        buNome,
      });
    } else {
      return NextResponse.json(
        { error: "fonte inválida", aceitas: ["contas-pagar", "dre"] },
        { status: 400 },
      );
    }
  } catch (e) {
    console.error("[exportar] falha:", (e as Error).message);
    return NextResponse.json(
      { error: "falha ao gerar a extração", detalhe: (e as Error).message },
      { status: 500 },
    );
  }

  if (recortou) {
    extracao.avisos.unshift({
      nivel: "atencao",
      texto: `Período recortado em ${TETO_MESES} meses (até ${ateReal}). Para ir além, faça em duas extrações.`,
    });
  }

  // --- prévia: só o que a tela precisa para decidir ------------------------- //
  if (q.get("preview") === "1") {
    return NextResponse.json({
      titulo: extracao.titulo,
      subtitulo: extracao.subtitulo,
      linhas: extracao.linhas.length,
      colunas: extracao.colunas.length,
      avisos: extracao.avisos,
      totais: extracao.totais ?? null,
    });
  }

  const arquivo = nomeArquivo(extracao.titulo, `${de}_a_${ateReal}${buNome ? `_${buNome}` : ""}`);
  return new NextResponse(paraCsv(extracao), {
    headers: {
      // `charset=utf-8` + o BOM do serializador: o par que faz o Excel do
      // Windows abrir com acento correto.
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${arquivo}"`,
      "cache-control": "no-store",
    },
  });
}
