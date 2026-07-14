"use server";

import { revalidatePath } from "next/cache";

import { updateProfileSettings } from "@/lib/db/profile";
import { createClient } from "@/lib/supabase/server";

export type SettingsState = { error?: string; message?: string };

/** Salva nome (apelido) e instruções customizadas do usuário. */
export async function saveProfileSettings(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const nickname = String(formData.get("nickname") ?? "").trim();
  const customInstructions = String(
    formData.get("customInstructions") ?? "",
  ).trim();

  try {
    await updateProfileSettings({ nickname, customInstructions });
  } catch {
    return { error: "Não foi possível salvar. Tente novamente." };
  }

  revalidatePath("/", "layout");
  return { message: "Configurações salvas." };
}

/**
 * Redefine a senha do PRÓPRIO usuário logado (self-service). Usa a sessão atual
 * via `updateUser` — não depende de e-mail/SMTP nem de link de recuperação.
 */
export async function changeOwnPassword(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 8) {
    return { error: "A senha deve ter pelo menos 8 caracteres." };
  }
  if (password !== confirm) {
    return { error: "As senhas não coincidem." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { error: "Não foi possível atualizar a senha. Tente novamente." };
  }

  return { message: "Senha atualizada." };
}
