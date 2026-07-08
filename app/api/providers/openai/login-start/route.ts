import { NextResponse } from "next/server";

import { canManageConexoes } from "@/lib/ai/codex-oauth";
import { startLoopbackLogin } from "@/lib/ai/codex-loopback";

export const runtime = "nodejs";

// Login automático (sem colar URL): sobe o listener em 127.0.0.1:1455 e devolve
// a URL de autorização. O redirect é capturado sozinho pelo loopback.
// Só serve quando o navegador está na MESMA máquina do servidor (dev/local).
export async function POST() {
  if (!(await canManageConexoes())) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }
  try {
    const { authorizeUrl } = await startLoopbackLogin();
    return NextResponse.json({ authorize_url: authorizeUrl });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
