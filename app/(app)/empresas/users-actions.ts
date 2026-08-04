"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import {
  assignMemberRole,
  inviteMember,
  sendPasswordReset,
  setMemberName,
} from "@/lib/db/users";

export type UserActionState = { ok?: boolean; error?: string };

const fail = (e: unknown): UserActionState => ({
  error: e instanceof Error ? e.message : "Falha.",
});

/** Origin do request (mesmo padrão do login), para montar o redirect do convite. */
async function getOrigin(): Promise<string> {
  const h = await headers();
  const origin = h.get("origin");
  if (origin) return origin;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : process.env.NEXT_PUBLIC_BASE_URL!;
}

export async function inviteMemberAction(input: {
  companyId: string;
  email: string;
  roleId: string;
  nome?: string;
}): Promise<UserActionState> {
  if (!input.roleId) return { error: "Escolha uma role." };
  try {
    const redirectTo = `${await getOrigin()}/auth/confirm?next=/atualizar-senha`;
    await inviteMember(
      input.companyId,
      input.email,
      input.roleId,
      redirectTo,
      input.nome,
    );
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/empresas/${input.companyId}`);
  return { ok: true };
}

/** Define/corrige o nome do usuário (`profiles.full_name`). */
export async function setMemberNameAction(input: {
  userId: string;
  nome: string;
}): Promise<UserActionState> {
  let companyId: string;
  try {
    companyId = await setMemberName(input.userId, input.nome);
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/empresas/${companyId}`);
  return { ok: true };
}

/**
 * Dispara o e-mail de redefinição de senha. Quem administra NUNCA vê nem define
 * a senha — o usuário escolhe a dele pelo link.
 */
export async function resetPasswordAction(input: {
  userId: string;
}): Promise<UserActionState> {
  try {
    const redirectTo = `${await getOrigin()}/auth/confirm?next=/atualizar-senha`;
    await sendPasswordReset(input.userId, redirectTo);
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

export async function assignMemberRoleAction(input: {
  userId: string;
  roleId: string;
}): Promise<UserActionState> {
  let companyId: string;
  try {
    companyId = await assignMemberRole(input.userId, input.roleId);
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/empresas/${companyId}`);
  return { ok: true };
}
