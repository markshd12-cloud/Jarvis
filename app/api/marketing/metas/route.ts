import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getSessionContext } from "@/lib/db/permissions";
import {
  alvosDeMeta,
  getMetasComAtual,
  removerMeta,
  salvarMeta,
  type MetricaMeta,
} from "@/lib/marketing/metas";
import { can } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Metas do painel de Marketing. GLOBAL (o módulo não é escopado por empresa).
 *
 * - Ler exige `marketing`.
 * - Gravar exige `marketing:gerenciar` — meta é decisão de gestão, não leitura.
 */
const COMP = /^\d{4}-\d{2}$/;

function competenciaDe(req: NextRequest): string {
  const raw = req.nextUrl.searchParams.get("competencia") ?? "";
  if (COMP.test(raw)) return raw;
  // Mês corrente em São Paulo — o servidor é UTC e na virada do mês o fuso
  // errado devolveria a competência anterior.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  })
    .format(new Date())
    .slice(0, 7);
}

export async function GET(req: NextRequest) {
  const ctx = await getSessionContext();
  if (!can(ctx, "marketing"))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const competencia = competenciaDe(req);
  try {
    return NextResponse.json({ competencia, metas: await getMetasComAtual(competencia) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/**
 * A `direcao` NÃO vem do cliente: é propriedade da métrica (custo é teto,
 * seguidor é piso). Aceitar do corpo deixaria gravar uma linha com a cor
 * invertida. Aqui ela é resolvida a partir do catálogo de alvos, que também
 * valida se o par (metrica, alvo) existe de fato.
 */
const schema = z.object({
  metrica: z.string().min(1),
  alvo: z.string().min(1),
  competencia: z.string().regex(COMP, "competência AAAA-MM"),
  /** Vazio/null remove a meta — é como a tela "apaga" um valor digitado. */
  valor: z.coerce.number().nonnegative().nullish(),
});

export async function POST(req: NextRequest) {
  const ctx = await getSessionContext();
  if (!can(ctx, "marketing", "gerenciar"))
    return NextResponse.json({ error: "sem permissão" }, { status: 403 });

  try {
    const v = schema.parse(await req.json());
    const alvo = alvosDeMeta().find(
      (a) => a.metrica === v.metrica && a.alvo === v.alvo,
    );
    if (!alvo)
      return NextResponse.json(
        { error: "métrica/alvo desconhecido" },
        { status: 400 },
      );

    if (v.valor == null) {
      await removerMeta(alvo.metrica as MetricaMeta, alvo.alvo, v.competencia);
      return NextResponse.json({ ok: true, removida: true });
    }

    await salvarMeta({
      metrica: alvo.metrica,
      alvo: alvo.alvo,
      competencia: v.competencia,
      valor: v.valor,
      direcao: alvo.direcao,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
