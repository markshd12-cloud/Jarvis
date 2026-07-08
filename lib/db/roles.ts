import { assertCanManageCompany } from "@/lib/db/permissions";
import { FEATURES, type Permissions } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";

export interface RoleInput {
  name: string;
  description: string;
  permissions: Permissions;
}

/** Mantém só recursos/ações conhecidos (evita gravar lixo vindo do cliente). */
function sanitizePermissions(input: Permissions | undefined): Permissions {
  const out: Permissions = {};
  for (const feature of FEATURES) {
    const requested = input?.[feature.key];
    if (!Array.isArray(requested)) continue;
    const kept = feature.actions.filter((a) => requested.includes(a));
    if (kept.length) out[feature.key] = kept;
  }
  return out;
}

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

export async function createRole(
  companyId: string,
  input: RoleInput,
): Promise<string> {
  await assertCanManageCompany(companyId);
  const name = input.name.trim();
  if (!name) throw new Error("Informe o nome da role.");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("roles")
    .insert({
      company_id: companyId,
      name,
      description: input.description?.trim() ?? "",
      permissions: sanitizePermissions(input.permissions),
      is_builtin: false,
    })
    .select("id")
    .single();

  if (error || !data) {
    if (isUniqueViolation(error)) throw new Error("Já existe uma role com esse nome.");
    throw new Error(error?.message ?? "Falha ao criar role.");
  }
  return data.id as string;
}

/** Atualiza a role. Built-in não pode ser renomeada. Retorna o company_id. */
export async function updateRole(roleId: string, input: RoleInput): Promise<string> {
  const admin = createAdminClient();
  const { data: role } = await admin
    .from("roles")
    .select("company_id, is_builtin")
    .eq("id", roleId)
    .maybeSingle();
  if (!role) throw new Error("Role não encontrada.");
  await assertCanManageCompany(role.company_id);

  const patch: Record<string, unknown> = {
    description: input.description?.trim() ?? "",
    permissions: sanitizePermissions(input.permissions),
  };
  if (!role.is_builtin) {
    const name = input.name.trim();
    if (!name) throw new Error("Informe o nome da role.");
    patch.name = name;
  }

  const { error } = await admin.from("roles").update(patch).eq("id", roleId);
  if (error) {
    if (isUniqueViolation(error)) throw new Error("Já existe uma role com esse nome.");
    throw new Error(error.message);
  }
  return role.company_id as string;
}

/** Exclui a role. Bloqueia built-in e roles ainda atribuídas. Retorna company_id. */
export async function deleteRole(roleId: string): Promise<string> {
  const admin = createAdminClient();
  const { data: role } = await admin
    .from("roles")
    .select("company_id, is_builtin")
    .eq("id", roleId)
    .maybeSingle();
  if (!role) throw new Error("Role não encontrada.");
  await assertCanManageCompany(role.company_id);
  if (role.is_builtin) throw new Error("Roles built-in não podem ser excluídas.");

  const { count } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role_id", roleId);
  if ((count ?? 0) > 0) {
    throw new Error("Há usuários com esta role. Reatribua-os antes de excluir.");
  }

  const { error } = await admin.from("roles").delete().eq("id", roleId);
  if (error) throw new Error(error.message);
  return role.company_id as string;
}
