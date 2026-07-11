"use server";

import { revalidatePath } from "next/cache";

import { listCompanies } from "@/lib/db/companies";
import { getSessionContext, type SessionContext } from "@/lib/db/permissions";
import {
  createManualSource,
  deleteManualSource,
  getManualSourceTarget,
  type SourceTarget,
  updateManualSource,
} from "@/lib/db/sources";
import { can } from "@/lib/permissions";
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
 * Autoriza ESCRITA de fontes: sessão válida + permissão `personalizar:editar`
 * (superadmin passa direto). Server Actions são endpoints POST acessíveis
 * diretamente, então o gate de permissão precisa viver AQUI — esconder o botão
 * na UI não basta.
 */
async function authorizeWrite(): Promise<SessionContext | { error: string }> {
  const ctx = await getSessionContext();
  if (!ctx.userId) return { error: "Sessão inválida. Entre novamente." };
  if (!can(ctx, "personalizar", "editar"))
    return { error: "Sem permissão para alterar as fontes." };
  return ctx;
}

/**
 * Traduz os checkboxes do formulário para o alvo (pessoal ou empresas),
 * VALIDANDO o que cada papel pode escolher. Nunca confia no cliente: um comum só
 * pode marcar a própria empresa; o superadmin pode marcar quaisquer empresas.
 * "Única" (pessoal) tem prioridade e ignora as empresas.
 */
async function resolveTarget(
  ctx: SessionContext,
  formData: FormData,
): Promise<SourceTarget | { error: string }> {
  const personal = formData.get("personal") === "1";
  if (personal) return { ownerId: ctx.userId!, companyIds: [] };

  const ids = [
    ...new Set(formData.getAll("companyIds").map(String).filter(Boolean)),
  ];
  if (ids.length === 0)
    return { error: "Marque ao menos uma empresa ou a opção “Única”." };

  if (ctx.isSuperadmin) {
    const valid = new Set((await listCompanies()).map((c) => c.id));
    if (!ids.every((id) => valid.has(id))) return { error: "Empresa inválida." };
    return { ownerId: null, companyIds: ids };
  }

  // Usuário comum: só pode marcar a própria empresa.
  if (!ctx.companyId || !ids.every((id) => id === ctx.companyId))
    return { error: "Sem permissão para essas empresas." };
  return { ownerId: null, companyIds: [ctx.companyId] };
}

/** O usuário pode editar/excluir uma fonte com ESTE alcance atual? */
function canEditTarget(ctx: SessionContext, target: SourceTarget): boolean {
  if (target.ownerId) return target.ownerId === ctx.userId; // pessoal: só o dono
  if (ctx.isSuperadmin) return true; // empresas: superadmin sempre
  return !!ctx.companyId && target.companyIds.includes(ctx.companyId);
}

/**
 * Cria uma fonte estática, por TEXTO digitado ou por ARQUIVO enviado
 * (HTML/CSV/TSV/TXT/MD/JSON), no escopo escolhido.
 */
export async function createSource(
  _prev: SourceState,
  formData: FormData,
): Promise<SourceState> {
  const ctx = await authorizeWrite();
  if ("error" in ctx) return { error: ctx.error };

  const target = await resolveTarget(ctx, formData);
  if ("error" in target) return { error: target.error };

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
    await createManualSource(target, title, content);
  } catch (e) {
    console.error("[sources] criar", e);
    return { error: "Não foi possível salvar. Tente novamente." };
  }

  revalidatePath("/personalizar");
  return { ok: true };
}

/** Atualiza conteúdo e escopo de uma fonte estática existente. */
export async function updateSource(
  _prev: SourceState,
  formData: FormData,
): Promise<SourceState> {
  const ctx = await authorizeWrite();
  if ("error" in ctx) return { error: ctx.error };

  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Fonte inválida." };

  // Precisa poder editar a fonte NO ESTADO ATUAL antes de mexer nela.
  const current = await getManualSourceTarget(id);
  if (!current) return { error: "Fonte não encontrada." };
  if (!canEditTarget(ctx, current))
    return { error: "Sem permissão para alterar esta fonte." };

  // ...e o novo escopo tem que ser um que ele possa criar.
  const target = await resolveTarget(ctx, formData);
  if ("error" in target) return { error: target.error };

  const title = String(formData.get("title") ?? "").trim();
  let content = String(formData.get("content") ?? "").trim();
  const error = validate(title, content);
  if (error) return { error };
  if (content.length > MAX_CONTENT) content = content.slice(0, MAX_CONTENT);

  try {
    await updateManualSource(id, target, title, content);
  } catch (e) {
    console.error("[sources] atualizar", e);
    return { error: "Não foi possível salvar. Tente novamente." };
  }

  revalidatePath("/personalizar");
  return { ok: true };
}

/** Exclui uma fonte estática (form action simples). */
export async function deleteSource(formData: FormData): Promise<void> {
  const ctx = await authorizeWrite();
  if ("error" in ctx) return;

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const current = await getManualSourceTarget(id);
  if (!current || !canEditTarget(ctx, current)) return;

  try {
    await deleteManualSource(id);
  } catch (e) {
    console.error("[sources] excluir", e);
  }

  revalidatePath("/personalizar");
}
