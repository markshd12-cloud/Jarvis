import { NextResponse } from "next/server";

import { importFromProfiles } from "@/lib/financeiro/colaboradores";
import { finContext } from "@/lib/financeiro/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Importa usuários da empresa (profiles) como colaboradores. Idempotente.
export async function POST() {
  const gate = await finContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  try {
    return NextResponse.json(await importFromProfiles(gate.companyId));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
