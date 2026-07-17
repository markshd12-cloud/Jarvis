import { NextResponse, type NextRequest } from "next/server";

import {
  createCategoria,
  getCategoriaTree,
  listCategorias,
} from "@/lib/financeiro/categorias";
import { finContext } from "@/lib/financeiro/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Categorias financeiras: lista plana + árvore por grupo DRE. Gated por `financeiro`.
export async function GET() {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const [categorias, tree] = await Promise.all([
    listCategorias(gate.companyId),
    getCategoriaTree(gate.companyId),
  ]);
  return NextResponse.json({ categorias, tree });
}

export async function POST(req: NextRequest) {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  try {
    const categoria = await createCategoria(gate.companyId, await req.json());
    return NextResponse.json({ categoria }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
