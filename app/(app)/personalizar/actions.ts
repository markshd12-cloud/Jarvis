"use server";

import { revalidatePath } from "next/cache";

import { getCompanyId } from "@/lib/db/company";
import {
  createManualSource,
  deleteManualSource,
  updateManualSource,
} from "@/lib/db/sources";
import { extractFileText } from "@/lib/sources/extract";

export type SourceState = { error?: string; ok?: boolean };

const MAX_TITLE = 120;
const MAX_CONTENT = 200_000;

function validate(title: string, content: string): string | null {
  if (!title) return "Informe um título.";
  if (title.length > MAX_TITLE) return "Título muito longo.";
  if (!content) return "Informe o conteúdo ou envie um arquivo.";
  return null;
}

/**
 * Cria uma fonte estática, por TEXTO digitado ou por ARQUIVO enviado
 * (HTML/CSV/TSV/TXT/MD/JSON). Verifica auth/empresa aqui (a action é acessível
 * por POST direto).
 */
export async function createSource(
  _prev: SourceState,
  formData: FormData,
): Promise<SourceState> {
  const companyId = await getCompanyId();
  if (!companyId) return { error: "Sessão inválida. Entre novamente." };

  let title = String(formData.get("title") ?? "").trim();
  let content = String(formData.get("content") ?? "").trim();

  // Arquivo tem prioridade: extrai o texto e usa o nome como título padrão.
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    try {
      const extracted = await extractFileText(file);
      content = extracted.text;
      if (!title) title = extracted.title;
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Falha ao ler o arquivo." };
    }
  }

  const error = validate(title, content);
  if (error) return { error };
  if (content.length > MAX_CONTENT) content = content.slice(0, MAX_CONTENT);

  try {
    await createManualSource(companyId, title, content);
  } catch (e) {
    console.error("[sources] criar", e);
    return { error: "Não foi possível salvar. Tente novamente." };
  }

  revalidatePath("/personalizar");
  return { ok: true };
}

/** Atualiza uma fonte estática existente (escopada à empresa do usuário). */
export async function updateSource(
  _prev: SourceState,
  formData: FormData,
): Promise<SourceState> {
  const companyId = await getCompanyId();
  if (!companyId) return { error: "Sessão inválida. Entre novamente." };

  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Fonte inválida." };

  const title = String(formData.get("title") ?? "").trim();
  let content = String(formData.get("content") ?? "").trim();
  const error = validate(title, content);
  if (error) return { error };
  if (content.length > MAX_CONTENT) content = content.slice(0, MAX_CONTENT);

  try {
    await updateManualSource(companyId, id, title, content);
  } catch (e) {
    console.error("[sources] atualizar", e);
    return { error: "Não foi possível salvar. Tente novamente." };
  }

  revalidatePath("/personalizar");
  return { ok: true };
}

/** Exclui uma fonte estática (form action simples). */
export async function deleteSource(formData: FormData): Promise<void> {
  const companyId = await getCompanyId();
  if (!companyId) return;

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  try {
    await deleteManualSource(companyId, id);
  } catch (e) {
    console.error("[sources] excluir", e);
  }

  revalidatePath("/personalizar");
}
