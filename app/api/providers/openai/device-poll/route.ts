import { NextResponse, type NextRequest } from "next/server";

import { oauthConfig, writeCodexAuth } from "@/lib/ai/codex-auth";
import { canManageConexoes, DEVICE_COOKIE } from "@/lib/ai/codex-oauth";

export const runtime = "nodejs";

/** Endpoint de poll do device: override por env ou derivado do usercode URL. */
function deviceTokenUrl(deviceCodeUrl: string): string {
  if (process.env.OPENAI_OAUTH_DEVICE_TOKEN_URL) {
    return process.env.OPENAI_OAUTH_DEVICE_TOKEN_URL;
  }
  if (deviceCodeUrl.endsWith("/usercode")) {
    return deviceCodeUrl.slice(0, -"/usercode".length) + "/token";
  }
  return deviceCodeUrl.replace(/\/[^/]*$/, "/token");
}

// Poll do Device Auth: pergunta se o usuário já autorizou. Quando autoriza,
// troca o authorization_code por tokens e grava o auth.json.
export async function POST(req: NextRequest) {
  if (!(await canManageConexoes())) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const cookie = req.cookies.get(DEVICE_COOKIE)?.value;
  if (!cookie) {
    return NextResponse.json(
      { status: "error", message: "Nenhum login pendente." },
      { status: 400 },
    );
  }
  let device: { id: string; code: string };
  try {
    device = JSON.parse(cookie);
  } catch {
    return NextResponse.json(
      { status: "error", message: "Estado de login corrompido." },
      { status: 400 },
    );
  }

  const cfg = oauthConfig();
  const res = await fetch(deviceTokenUrl(cfg.deviceCodeUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_auth_id: device.id, user_code: device.code }),
  });

  // Ainda não autorizado.
  if (res.status === 403 || res.status === 404) {
    return NextResponse.json({ status: "pending" });
  }
  if (!res.ok) {
    return NextResponse.json(
      { status: "error", message: "Polling falhou." },
      { status: 500 },
    );
  }

  const authData = (await res.json()) as {
    authorization_code: string;
    code_verifier: string;
  };

  const tokenRes = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: authData.authorization_code,
      code_verifier: authData.code_verifier,
      client_id: cfg.clientId,
    }),
  });
  if (!tokenRes.ok) {
    return NextResponse.json(
      { status: "error", message: "Troca de token falhou." },
      { status: 500 },
    );
  }

  await writeCodexAuth(
    (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
      id_token?: string;
    },
  );

  const out = NextResponse.json({ status: "authorized" });
  out.cookies.delete(DEVICE_COOKIE);
  return out;
}
