import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * Confirma o login por email. Suporta os dois fluxos do Supabase:
 * - token_hash + type (template apontando para /auth/confirm) → verifyOtp
 * - code (fluxo PKCE) → exchangeCodeForSession
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  // O Supabase pode redirecionar para cá com erro (ex.: link expirado/já usado).
  const errorCode = searchParams.get("error_code");
  if (errorCode) {
    console.error(
      "[auth/confirm] link inválido/expirado:",
      errorCode,
      searchParams.get("error_description"),
    );
    return NextResponse.redirect(new URL("/login?error=expired", request.url));
  }

  const supabase = await createClient();

  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      return NextResponse.redirect(new URL(next, request.url));
    }
    console.error("[auth/confirm] verifyOtp falhou:", type, error.status, error.message);
    return NextResponse.redirect(new URL("/login?error=link", request.url));
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, request.url));
    }
    console.error("[auth/confirm] exchangeCodeForSession falhou:", error.status, error.message);
    return NextResponse.redirect(new URL("/login?error=link", request.url));
  }

  // Nenhum parâmetro de verificação chegou — quase sempre o template de email
  // está no formato padrão (não aponta para /auth/confirm com token_hash).
  console.error("[auth/confirm] sem token_hash/type/code. URL recebida:", request.url);
  return NextResponse.redirect(new URL("/login?error=link", request.url));
}
