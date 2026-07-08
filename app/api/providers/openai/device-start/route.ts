import { NextResponse } from "next/server";

import { oauthConfig } from "@/lib/ai/codex-auth";
import {
  canManageConexoes,
  DEVICE_COOKIE,
  FLOW_COOKIE_MAX_AGE,
} from "@/lib/ai/codex-oauth";

export const runtime = "nodejs";

// Device Auth: pede um user_code que o usuário digita em auth.openai.com/codex/device.
// Algumas organizações desabilitam esse fluxo — nesse caso, use Browser OAuth.
export async function POST() {
  if (!(await canManageConexoes())) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const cfg = oauthConfig();
  if (!cfg.deviceCodeUrl) {
    return NextResponse.json(
      { error: "Device Auth não configurado (OPENAI_OAUTH_DEVICE_CODE_URL)." },
      { status: 400 },
    );
  }

  const res = await fetch(cfg.deviceCodeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: cfg.clientId }),
  });
  if (!res.ok) {
    return NextResponse.json(
      { error: "Device Auth não disponível para sua organização." },
      { status: 400 },
    );
  }

  const data = (await res.json()) as {
    device_auth_id: string;
    user_code: string;
    interval?: number;
    expires_in?: number;
  };

  const out = NextResponse.json({
    user_code: data.user_code,
    verification_url: "https://auth.openai.com/codex/device",
    interval: data.interval ?? 5,
    expires_in: data.expires_in ?? 900,
  });
  out.cookies.set(
    DEVICE_COOKIE,
    JSON.stringify({ id: data.device_auth_id, code: data.user_code }),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: FLOW_COOKIE_MAX_AGE,
    },
  );
  return out;
}
