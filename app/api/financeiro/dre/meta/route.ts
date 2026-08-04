import { NextResponse, type NextRequest } from "next/server";

import { invalidateDre } from "@/lib/contaazul/dre";
import { finContext } from "@/lib/financeiro/context";
import { saveOrcamento } from "@/lib/financeiro/orcamentos";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  ca_categoria_id: z.string().min(1),
  competencia: z.string().regex(/^\d{4}-\d{2}$/, "competência AAAA-MM"),
  valor: z.coerce.number().nonnegative(),
  /**
   * BU do DRE em que a meta foi digitada. Ausente/null = "Todas".
   *
   * Antes era fixo em null, e isso quebrava a meta por empresa: o DRE filtrado
   * por uma BU LÊ só as metas daquela BU (`orcadoPorCategoriaCa`), mas a
   * gravação mandava tudo para "Todas". A meta era salva numa gaveta e
   * procurada em outra — na volta a célula aparecia zerada, como se não tivesse
   * salvado.
   */
  bu_id: z.string().uuid().nullish(),
});

/**
 * Grava a META de uma linha do DRE digitada DIRETO na tabela (Faturamento
 * Bruto). Resolve a folha do DRE (`ca_categoria_id`) para a nossa categoria e
 * faz o MESMO upsert do Orçamento & Limite (`fin_orcamentos`) — as duas telas
 * ficam automaticamente em sincronia. Valor 0 zera a meta.
 *
 * A meta é gravada na MESMA BU em que o DRE está sendo visto, para que a leitura
 * encontre o que a escrita gravou.
 */
export async function POST(req: NextRequest) {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  try {
    const v = schema.parse(await req.json());
    const admin = createAdminClient();
    const { data: cat, error } = await admin
      .from("fin_categorias")
      .select("id")
      .eq("company_id", gate.companyId)
      .eq("ca_categoria_id", v.ca_categoria_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!cat)
      return NextResponse.json(
        { error: "Categoria sem de-para no Jarvis — rode o seed de categorias." },
        { status: 400 },
      );
    const orc = await saveOrcamento(gate.companyId, {
      categoria_id: cat.id as string,
      bu_id: v.bu_id ?? null,
      competencia: v.competencia,
      valor_orcado: v.valor,
      valor_limite: null,
    });
    invalidateDre(gate.companyId); // a meta aparece no DRE na hora
    return NextResponse.json({ ok: true, id: orc.id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
