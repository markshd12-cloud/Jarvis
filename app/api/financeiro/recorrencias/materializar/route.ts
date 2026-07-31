import { NextResponse, type NextRequest } from "next/server";

import { invalidateDre } from "@/lib/contaazul/dre";
import { finContext } from "@/lib/financeiro/context";
import { materializar } from "@/lib/financeiro/recorrencias";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Gera as despesas do mês a partir das recorrências ativas. Idempotente (pula
 * quem já tem despesa no mês — NUNCA duplica nem altera o que já existe em
 * Contas a Pagar). Body: { competencia?: "AAAA-MM" } (default = mês corrente).
 *
 * - **Manual**: usuário com permissão `financeiro` → empresa corrente.
 * - **Cron** (`x-cron-secret`): roda para todas as empresas com recorrência
 *   ativa — é o que garante que toda recorrência "vá para Contas a Pagar" na
 *   virada do mês sem ninguém precisar lembrar.
 */
export async function POST(req: NextRequest) {
  const cronSecret = req.headers.get("x-cron-secret");
  const isCron = !!process.env.CRON_SECRET && cronSecret === process.env.CRON_SECRET;

  const body = await req.json().catch(() => ({}));
  const competencia =
    typeof body.competencia === "string" && /^\d{4}-\d{2}$/.test(body.competencia)
      ? body.competencia
      : new Date().toISOString().slice(0, 7);

  if (isCron) {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("fin_recorrencias")
      .select("company_id")
      .eq("ativo", true);
    if (error)
      return NextResponse.json({ error: `recorrências: ${error.message}` }, { status: 500 });
    const empresas = [...new Set((data ?? []).map((r) => r.company_id as string))];
    const resultados: {
      companyId: string;
      gerados: number;
      pulados: number;
      erros: string[];
    }[] = [];
    for (const companyId of empresas) {
      try {
        const r = await materializar(companyId, competencia);
        if (r.gerados > 0) invalidateDre(companyId);
        resultados.push({ companyId, ...r });
      } catch (e) {
        resultados.push({
          companyId,
          gerados: 0,
          pulados: 0,
          erros: [(e as Error).message],
        });
      }
    }
    return NextResponse.json({ cron: true, competencia, resultados });
  }

  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  try {
    const res = await materializar(gate.companyId, competencia);
    if (res.gerados > 0) invalidateDre(gate.companyId); // parcelas novas → DRE na hora
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
