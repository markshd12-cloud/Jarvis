import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Inicia o OAuth do Notion (exige usuário autenticado).
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // Anti-CSRF: state aleatório guardado em cookie httpOnly e validado no callback.
  const state = crypto.randomUUID();

  const params = new URLSearchParams({
    client_id: process.env.NOTION_CLIENT_ID!,
    redirect_uri: process.env.NOTION_REDIRECT_URI!,
    response_type: "code",
    owner: "user",
    state,
  });

  const res = NextResponse.redirect(
    `https://api.notion.com/v1/oauth/authorize?${params.toString()}`,
  );
  res.cookies.set("notion_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
