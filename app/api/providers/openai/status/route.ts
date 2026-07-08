import { NextResponse } from "next/server";

import { codexAuthStatus } from "@/lib/ai/codex-auth";
import { canManageConexoes } from "@/lib/ai/codex-oauth";
import { loopbackError } from "@/lib/ai/codex-loopback";

export const runtime = "nodejs";

// Status do login do ChatGPT (conectado? conta? expiração?). Nunca expõe token.
// Inclui o último erro do fluxo de loopback (login automático), se houver, para
// a UI diferenciar "ainda aguardando" de "falhou".
export async function GET() {
  if (!(await canManageConexoes())) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }
  try {
    return NextResponse.json({
      ...(await codexAuthStatus()),
      loginError: loopbackError(),
    });
  } catch (error) {
    return NextResponse.json(
      { connected: false, error: (error as Error).message },
      { status: 200 },
    );
  }
}
