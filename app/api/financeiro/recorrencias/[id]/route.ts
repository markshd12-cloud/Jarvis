import { NextResponse, type NextRequest } from "next/server";

import { invalidateDre } from "@/lib/contaazul/dre";
import { finContext } from "@/lib/financeiro/context";
import {
  contarFuturosGerados,
  deleteRecorrencia,
  removerFuturosGerados,
  setRecorrenciaAtivo,
  updateRecorrencia,
} from "@/lib/financeiro/recorrencias";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Quantos meses FUTUROS (não pagos) esta recorrência tem gerados. A UI chama
 * antes de excluir/inativar para perguntar ao usuário — com o horizonte de 12
 * meses, apagar sem avisar deixaria (ou tiraria) um ano de despesa do DRE.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { id } = await params;
  return NextResponse.json({ futuros: await contarFuturosGerados(gate.companyId, id) });
}

/**
 * Atualiza (campos) e/ou ativa/inativa (`{ ativo }`).
 * - Editar campos: `updateRecorrencia` já regera os meses futuros não pagos.
 * - Inativar com `?removerFuturos=1`: apaga também os meses futuros já gerados
 *   (a UI pergunta antes; sem o parâmetro, nada é removido).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { id } = await params;
  try {
    const { ativo, ...campos } = await req.json();
    let removidos = 0;
    if (typeof ativo === "boolean") {
      // Remove ANTES de inativar: `despesasFuturasIntocadas` não depende do
      // flag, mas manter a ordem deixa a intenção explícita.
      if (ativo === false && req.nextUrl.searchParams.get("removerFuturos") === "1")
        removidos = await removerFuturosGerados(gate.companyId, id);
      await setRecorrenciaAtivo(gate.companyId, id, ativo);
    }
    const recorrencia =
      Object.keys(campos).length > 0
        ? await updateRecorrencia(gate.companyId, id, campos)
        : null;
    invalidateDre(gate.companyId);
    return NextResponse.json({ ok: true, recorrencia, removidos });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

/**
 * Exclui a recorrência. Com `?removerFuturos=1`, apaga também as despesas
 * futuras não pagas que ela gerou (a UI pergunta antes). Sem o parâmetro, as
 * despesas permanecem em Contas a Pagar, apenas soltas do vínculo.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { id } = await params;
  try {
    let removidos = 0;
    if (req.nextUrl.searchParams.get("removerFuturos") === "1")
      removidos = await removerFuturosGerados(gate.companyId, id);
    await deleteRecorrencia(gate.companyId, id);
    invalidateDre(gate.companyId);
    return NextResponse.json({ ok: true, removidos });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 409 });
  }
}
