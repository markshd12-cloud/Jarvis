import type { UserRole } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

export type { UserRole };

/**
 * Papel do usuário autenticado (`member` se não houver sessão/perfil).
 * Lê via cliente autenticado — a policy `profiles_select_company` permite ler
 * o próprio perfil; nunca use isto para decidir escrita privilegiada (o guard
 * no banco é a fonte da verdade).
 */
export async function getSessionRole(): Promise<UserRole> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return "member";

  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  return (data?.role as UserRole) ?? "member";
}

export interface ProfileSettings {
  nickname: string;
  customInstructions: string;
}

const empty: ProfileSettings = { nickname: "", customInstructions: "" };

/** Configurações pessoais do usuário autenticado (vazio se não houver sessão). */
export async function getProfileSettings(): Promise<ProfileSettings> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return empty;

  const { data } = await supabase
    .from("profiles")
    .select("nickname, custom_instructions")
    .eq("id", userId)
    .maybeSingle();

  return {
    nickname: data?.nickname ?? "",
    customInstructions: data?.custom_instructions ?? "",
  };
}

/** Atualiza as configurações pessoais do usuário autenticado. */
export async function updateProfileSettings(
  settings: ProfileSettings,
): Promise<void> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) throw new Error("Não autenticado.");

  const { error } = await supabase
    .from("profiles")
    .update({
      nickname: settings.nickname,
      custom_instructions: settings.customInstructions,
    })
    .eq("id", userId);
  if (error) throw new Error(error.message);
}
