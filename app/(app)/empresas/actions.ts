"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createCompany } from "@/lib/db/companies";

export type CompanyFormState = { ok?: boolean; error?: string };

const MAX_NAME = 120;

/** Cria uma empresa (semeia roles built-in) e abre a página dela. */
export async function createCompanyAction(
  _prev: CompanyFormState,
  formData: FormData,
): Promise<CompanyFormState> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Informe o nome da empresa." };
  if (name.length > MAX_NAME) return { error: "Nome muito longo." };

  let id: string;
  try {
    id = await createCompany(name);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falha ao criar empresa." };
  }

  revalidatePath("/empresas");
  redirect(`/empresas/${id}`);
}
