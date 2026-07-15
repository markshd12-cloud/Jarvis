import { NextResponse, type NextRequest } from "next/server";

import { getCompanyId } from "@/lib/db/company";
import {
  CONTA_AZUL_ENV,
  CONTA_AZUL_OAUTH,
  contaAzulRedirect,
} from "@/lib/contaazul/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function back(req: NextRequest, status: string) {
  // Conexões vivem em Configurações (modal, sem rota própria) — volta ao
  // dashboard; o status fica visível ao reabrir Configurações.
  const res = NextResponse.redirect(
    contaAzulRedirect(`/dashboard?contaazul=${status}`, req),
  );
  res.cookies.delete("contaazul_oauth_state");
  return res;
}

// Callback do OAuth: troca o code por token e guarda (service_role) por empresa.
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    return NextResponse.redirect(contaAzulRedirect("/login", req));
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (!code) return back(req, "erro");

  // Anti-CSRF: o state da query precisa bater com o cookie httpOnly.
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get("contaazul_oauth_state")?.value;
  if (!state || !cookieState || state !== cookieState) {
    return back(req, "erro");
  }

  const companyId = await getCompanyId();
  if (!companyId) return back(req, "erro");

  // Cognito: Basic auth (client_id:client_secret) + corpo x-www-form-urlencoded.
  const basic = Buffer.from(
    `${CONTA_AZUL_ENV.clientId}:${CONTA_AZUL_ENV.clientSecret}`,
  ).toString("base64");

  const res = await fetch(CONTA_AZUL_OAUTH.tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: CONTA_AZUL_ENV.redirectUri,
    }),
  });
  if (!res.ok) return back(req, "erro");

  const token = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    token_type?: string;
    expires_in?: number;
    scope?: string;
  };

  // expires_in vem em segundos → guardamos o INSTANTE de expiração para renovar.
  const expiresAt =
    typeof token.expires_in === "number"
      ? new Date(Date.now() + token.expires_in * 1000).toISOString()
      : null;

  const admin = createAdminClient();
  await admin.from("contaazul_connections").upsert(
    {
      company_id: companyId,
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      token_type: token.token_type,
      expires_at: expiresAt,
      scope: token.scope,
    },
    { onConflict: "company_id" },
  );

  return back(req, "conectado");
}
