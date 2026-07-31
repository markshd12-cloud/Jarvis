import { NextResponse, type NextRequest } from "next/server";

import { finContext } from "@/lib/financeiro/context";
import { sincronizarReceita } from "@/lib/financeiro/receita";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Sincroniza a receita do Conta Azul no snapshot. Idempotente (upsert por evento).
 * Body: { meses?: number } (janela de meses pra trás; default 12).
 *
 * Dois modos de autenticação:
 * - **Cron**: header `x-cron-secret` == CRON_SECRET → roda para TODAS as empresas
 *   com Conta Azul conectado (não há sessão/empresa corrente).
 * - **Manual**: usuário com permissão `financeiro` → só a empresa corrente.
 *
 * ⚠️ ESCOPO DELIBERADO — SÓ RECEITA, NUNCA DESPESA.
 * `sincronizarReceita` faz apenas UPSERT em `fin_receita_snapshot`, que é um
 * ESPELHO puro do CA (não existe lançamento de receita à mão no Jarvis) e nunca
 * apaga linha. Ele NÃO toca em `fin_despesas`/`fin_parcelas` — portanto não mexe
 * em nada que for lançado no Jarvis daqui pra frente: despesa, rateio por BU,
 * baixa e edição ficam intactos. O import de DESPESA segue manual DE PROPÓSITO:
 * automatizá-lo poderia duplicar uma despesa já lançada à mão no Jarvis.
 */
export async function POST(req: NextRequest) {
  const cronSecret = req.headers.get("x-cron-secret");
  const isCron = !!process.env.CRON_SECRET && cronSecret === process.env.CRON_SECRET;

  const body = await req.json().catch(() => ({}));
  const meses =
    typeof body.meses === "number" && body.meses > 0 && body.meses <= 48 ? body.meses : 12;

  if (isCron) {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("contaazul_connections")
      .select("company_id")
      .not("refresh_token", "is", null);
    if (error)
      return NextResponse.json({ error: `conexões: ${error.message}` }, { status: 500 });

    const empresas = (data ?? []).map((r) => r.company_id as string);
    const resultados: {
      companyId: string;
      ok: boolean;
      gravados: number;
      erro?: string;
    }[] = [];
    // Sequencial de propósito: cada empresa renova o próprio token do CA; em
    // paralelo haveria corrida de refresh_token (o Cognito pode rotacionar).
    for (const companyId of empresas) {
      try {
        const r = await sincronizarReceita(companyId, meses);
        resultados.push({
          companyId,
          ok: r.connected,
          gravados: r.gravados,
          erro: r.erro,
        });
      } catch (e) {
        resultados.push({ companyId, ok: false, gravados: 0, erro: (e as Error).message });
      }
    }
    return NextResponse.json({ cron: true, empresas: empresas.length, resultados });
  }

  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  return NextResponse.json(await sincronizarReceita(gate.companyId, meses));
}
