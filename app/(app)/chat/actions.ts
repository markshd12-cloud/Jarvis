"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { createConversation } from "@/lib/db/chat";
import { getCompanyId } from "@/lib/db/company";
import { createProject, deleteProject, updateProject } from "@/lib/db/projects";

const MAX_NAME = 120;
const MAX_INSTRUCTIONS = 20_000;

/** Cria um projeto (nome + instruções opcionais) e abre a página dele. */
export async function createProjectAction(formData: FormData): Promise<void> {
  const companyId = await getCompanyId();
  if (!companyId) return;

  const name = String(formData.get("name") ?? "").trim();
  if (!name || name.length > MAX_NAME) return;
  const instructions = String(formData.get("instructions") ?? "")
    .trim()
    .slice(0, MAX_INSTRUCTIONS);

  const id = await createProject(name, instructions);
  if (!id) return;

  revalidatePath("/chat", "layout");
  redirect(`/chat/projeto/${id}`);
}

/** Salva nome/instruções do projeto (contexto injetado nos chats). */
export async function updateProjectAction(formData: FormData): Promise<void> {
  const companyId = await getCompanyId();
  if (!companyId) return;

  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const name = String(formData.get("name") ?? "").trim();
  const instructions = String(formData.get("instructions") ?? "")
    .trim()
    .slice(0, MAX_INSTRUCTIONS);
  if (!name || name.length > MAX_NAME) return;

  await updateProject(id, { name, instructions });
  revalidatePath("/chat", "layout");
  redirect(`/chat/projeto/${id}`);
}

/** Exclui o projeto (os chats viram soltos via ON DELETE SET NULL). */
export async function deleteProjectAction(formData: FormData): Promise<void> {
  const companyId = await getCompanyId();
  if (!companyId) return;

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await deleteProject(id);
  revalidatePath("/chat", "layout");
  redirect("/chat");
}

/** Cria um novo chat DENTRO de um projeto e abre a conversa. */
export async function newChatInProjectAction(
  formData: FormData,
): Promise<void> {
  const companyId = await getCompanyId();
  if (!companyId) return;

  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return;

  const id = await createConversation({ projectId });
  if (!id) return;

  revalidatePath("/chat", "layout");
  redirect(`/chat/${id}`);
}
