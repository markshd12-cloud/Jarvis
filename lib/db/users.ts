import { assertCanManageCompany } from "@/lib/db/permissions";
import { createAdminClient } from "@/lib/supabase/admin";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Confere que a role existe e pertence à empresa (evita vincular role de outra). */
async function assertRoleInCompany(
  admin: ReturnType<typeof createAdminClient>,
  roleId: string,
  companyId: string,
): Promise<void> {
  const { data } = await admin
    .from("roles")
    .select("company_id")
    .eq("id", roleId)
    .maybeSingle();
  if (!data || data.company_id !== companyId) {
    throw new Error("Role inválida para esta empresa.");
  }
}

/**
 * Convida um usuário para a empresa: cria a conta (convite por e-mail) e vincula
 * empresa + role. O trigger `handle_new_user` cria o profile na empresa padrão;
 * aqui sobrescrevemos company_id/role_id via service_role (o guard permite).
 * `redirectTo` deve apontar para /auth/confirm?next=/atualizar-senha (a pessoa
 * define a própria senha ao abrir o link).
 */
export async function inviteMember(
  companyId: string,
  email: string,
  roleId: string,
  redirectTo: string,
): Promise<void> {
  await assertCanManageCompany(companyId);

  const normalized = email.trim().toLowerCase();
  if (!EMAIL_RE.test(normalized)) throw new Error("E-mail inválido.");

  const admin = createAdminClient();
  await assertRoleInCompany(admin, roleId, companyId);

  const { data, error } = await admin.auth.admin.inviteUserByEmail(normalized, {
    redirectTo,
  });
  if (error || !data?.user) {
    if (error?.status === 422 || /already/i.test(error?.message ?? "")) {
      throw new Error("Já existe um usuário com esse e-mail.");
    }
    throw new Error(error?.message ?? "Falha ao enviar o convite.");
  }

  const { error: profileError } = await admin
    .from("profiles")
    .update({ company_id: companyId, role_id: roleId, email: normalized })
    .eq("id", data.user.id);
  if (profileError) throw new Error(profileError.message);
}

/** Altera a role de um membro (dentro da mesma empresa). */
export async function assignMemberRole(
  userId: string,
  roleId: string,
): Promise<string> {
  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("company_id")
    .eq("id", userId)
    .maybeSingle();
  if (!profile?.company_id) throw new Error("Usuário não encontrado.");

  const companyId = profile.company_id as string;
  await assertCanManageCompany(companyId);
  await assertRoleInCompany(admin, roleId, companyId);

  const { error } = await admin
    .from("profiles")
    .update({ role_id: roleId })
    .eq("id", userId);
  if (error) throw new Error(error.message);

  return companyId;
}
