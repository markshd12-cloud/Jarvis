"use server";

import { revalidatePath } from "next/cache";

import { updateProfileSettings } from "@/lib/db/profile";

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
