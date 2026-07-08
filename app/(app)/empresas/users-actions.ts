"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { assignMemberRole, inviteMember } from "@/lib/db/users";

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
}): Promise<UserActionState> {
  if (!input.roleId) return { error: "Escolha uma role." };
  try {
    const redirectTo = `${await getOrigin()}/auth/confirm?next=/atualizar-senha`;
    await inviteMember(input.companyId, input.email, input.roleId, redirectTo);
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/empresas/${input.companyId}`);
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
