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
  nome?: string,
): Promise<void> {
  await assertCanManageCompany(companyId);

  const normalized = email.trim().toLowerCase();
  if (!EMAIL_RE.test(normalized)) throw new Error("E-mail inválido.");
  // Nome já no convite: sem ele a pessoa nasce sem identidade e todas as telas
  // (inclusive os colaboradores do financeiro) acabam mostrando o e-mail.
  const nomeLimpo = nome?.trim() || null;

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
    .update({
      company_id: companyId,
      role_id: roleId,
      email: normalized,
      ...(nomeLimpo ? { full_name: nomeLimpo } : {}),
    })
    .eq("id", data.user.id);
  if (profileError) throw new Error(profileError.message);
}

/**
 * Define o NOME do usuário (`profiles.full_name`).
 *
 * Existia um vácuo: o convite só pedia e-mail, não havia edição no painel, e o
 * único nome disponível era o `nickname` (o "como me chamar" do chat). Resultado:
 * todo lugar que mostra pessoa — inclusive os colaboradores do financeiro —
 * caía no e-mail. Aqui é o lugar de origem: preencher `full_name` conserta a
 * exibição em todas as telas de uma vez.
 */
export async function setMemberName(userId: string, nome: string): Promise<string> {
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("company_id")
    .eq("id", userId)
    .maybeSingle();
  if (!profile?.company_id) throw new Error("Usuário não encontrado.");
  const companyId = profile.company_id as string;
  await assertCanManageCompany(companyId);

  const limpo = nome.trim();
  if (!limpo) throw new Error("Informe o nome.");
  if (limpo.length > 120) throw new Error("Nome muito longo.");

  const { error } = await admin
    .from("profiles")
    .update({ full_name: limpo })
    .eq("id", userId);
  if (error) throw new Error(error.message);
  return companyId;
}

/**
 * Envia o e-mail de redefinição de senha. Não define a senha nem a expõe: o
 * usuário escolhe a própria pelo link — quem administra nunca vê a senha alheia.
 */
export async function sendPasswordReset(
  userId: string,
  redirectTo: string,
): Promise<string> {
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("company_id, email")
    .eq("id", userId)
    .maybeSingle();
  if (!profile?.company_id) throw new Error("Usuário não encontrado.");
  const companyId = profile.company_id as string;
  await assertCanManageCompany(companyId);

  const email = (profile.email as string | null)?.trim().toLowerCase();
  if (!email) throw new Error("Usuário sem e-mail cadastrado.");

  const { error } = await admin.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw new Error(error.message);
  return companyId;
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
