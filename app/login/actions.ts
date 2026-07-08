"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type AuthState = { error?: string; message?: string };

/** Origin do request (dev e prod), com fallback para o env. */
async function getOrigin() {
  const h = await headers();
  const origin = h.get("origin");
  if (origin) return origin;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : process.env.NEXT_PUBLIC_BASE_URL!;
}

/** Login por email + senha. */
export async function signIn(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!password) {
    return { error: "Informe a senha." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Mensagem genérica para evitar enumeração de usuários (Secure Vibe).
    return { error: "Email ou senha inválidos." };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

/** Encerra a sessão e volta para o login. */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

/** Login sem senha (magic link). Só para usuários já cadastrados. */
export async function sendMagicLink(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "");
  if (!email) return { error: "Informe o email." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${await getOrigin()}/auth/confirm`,
    },
  });

  // Loga o erro real no servidor (diagnóstico), mas devolve mensagem genérica
  // ao cliente para não revelar se o email existe (anti-enumeração).
  if (error) {
    console.error("[sendMagicLink]", error.status, error.message);
  }

  return { message: "Se houver uma conta, enviamos um link de acesso." };
}

/** Redefinição de senha: dispara o email de recuperação. */
export async function requestPasswordReset(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "");
  if (!email) return { error: "Informe o email." };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${await getOrigin()}/auth/confirm?next=/atualizar-senha`,
  });

  if (error) {
    console.error("[requestPasswordReset]", error.status, error.message);
  }

  return { message: "Se houver uma conta, enviamos um link para redefinir a senha." };
}
