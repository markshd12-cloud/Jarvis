import { NextResponse, type NextRequest } from "next/server";

import { getCompanyId } from "@/lib/db/company";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function back(req: NextRequest, status: string) {
  // Conexões vivem em Configurações (modal, sem rota própria) — volta ao
  // dashboard; o status da conexão fica visível ao reabrir Configurações.
  const res = NextResponse.redirect(
    new URL(`/dashboard?notion=${status}`, req.url),
  );
  res.cookies.delete("notion_oauth_state");
  return res;
}

// Callback do OAuth: troca o code por token e guarda (service_role) por empresa.
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (!code) return back(req, "erro");

  // Anti-CSRF: o state da query precisa bater com o cookie httpOnly.
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get("notion_oauth_state")?.value;
  if (!state || !cookieState || state !== cookieState) {
    return back(req, "erro");
  }

  const companyId = await getCompanyId();
  if (!companyId) return back(req, "erro");

  const basic = Buffer.from(
    `${process.env.NOTION_CLIENT_ID}:${process.env.NOTION_CLIENT_SECRET}`,
  ).toString("base64");

  const res = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.NOTION_REDIRECT_URI,
    }),
  });
  if (!res.ok) return back(req, "erro");

  const token = (await res.json()) as {
    access_token: string;
    workspace_id?: string;
    workspace_name?: string;
    bot_id?: string;
  };

  const admin = createAdminClient();
  await admin.from("notion_connections").upsert(
    {
      company_id: companyId,
      access_token: token.access_token,
      workspace_id: token.workspace_id,
      workspace_name: token.workspace_name,
      bot_id: token.bot_id,
    },
    { onConflict: "company_id" },
  );

  return back(req, "conectado");
}
