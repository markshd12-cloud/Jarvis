import { NextResponse } from "next/server";

import { getCompanyId } from "@/lib/db/company";
import { getSessionContext } from "@/lib/db/permissions";
import { runSeed } from "@/lib/financeiro/seed";
import { can } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Seed/import das dimensões do Conta Azul (Passo 2). Gateado por `financeiro`
 * (admin). Idempotente: rodar 2× não duplica. Retorna o relatório — o DoD exige
 * `semBu` e `semGrupo` vazios (ou revisados) antes de encerrar o passo.
 *
 * Aceita POST (uso pela UI, Passo 4) e GET (disparo manual pela barra de
 * endereço no dev — o console `fetch` esbarra no proxy/CSP; o seed é idempotente
 * e gateado, então um GET manual é seguro nesta fase).
 */
async function handle() {
  const ctx = await getSessionContext();
  if (!can(ctx, "financeiro"))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const companyId = await getCompanyId();
  if (!companyId)
    return NextResponse.json({ error: "sem empresa / Conta Azul desconectada" }, { status: 400 });

  try {
    const report = await runSeed(companyId);
    return NextResponse.json(report, { status: 200 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export const POST = handle;
export const GET = handle;
