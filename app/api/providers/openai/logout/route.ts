import { NextResponse } from "next/server";

import { clearCodexAuth } from "@/lib/ai/codex-auth";
import { canManageConexoes } from "@/lib/ai/codex-oauth";

export const runtime = "nodejs";

// Logout: remove ~/.codex/auth.json.
export async function POST() {
  if (!(await canManageConexoes())) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }
  await clearCodexAuth();
  return NextResponse.json({ status: "ok" });
}
