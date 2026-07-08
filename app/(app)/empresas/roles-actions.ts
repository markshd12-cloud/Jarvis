"use server";

import { revalidatePath } from "next/cache";

import { createRole, deleteRole, updateRole } from "@/lib/db/roles";
import type { Permissions } from "@/lib/permissions";

export type RoleActionState = { ok?: boolean; error?: string };

const fail = (e: unknown): RoleActionState => ({
  error: e instanceof Error ? e.message : "Falha ao salvar.",
});

export async function createRoleAction(input: {
  companyId: string;
  name: string;
  description: string;
  permissions: Permissions;
}): Promise<RoleActionState> {
  try {
    await createRole(input.companyId, input);
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/empresas/${input.companyId}`);
  return { ok: true };
}

export async function updateRoleAction(input: {
  roleId: string;
  name: string;
  description: string;
  permissions: Permissions;
}): Promise<RoleActionState> {
  let companyId: string;
  try {
    companyId = await updateRole(input.roleId, input);
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/empresas/${companyId}`);
  return { ok: true };
}

export async function deleteRoleAction(input: {
  roleId: string;
}): Promise<RoleActionState> {
  let companyId: string;
  try {
    companyId = await deleteRole(input.roleId);
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/empresas/${companyId}`);
  return { ok: true };
}
