import { getSessionContext } from "@/lib/db/permissions";
import type { Permissions } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";

export interface CompanySummary {
  id: string;
  name: string;
  createdAt: string;
  memberCount: number;
  roleCount: number;
}

export interface CompanyRole {
  id: string;
  name: string;
  description: string;
  permissions: Permissions;
  isBuiltin: boolean;
}

export interface CompanyMemberRow {
  id: string;
  email: string;
  role: string;
  roleId: string | null;
  roleName: string | null;
}

export interface CompanyDetail {
  id: string;
  name: string;
  createdAt: string;
  members: CompanyMemberRow[];
  roles: CompanyRole[];
}

/**
 * Roles built-in criadas junto de toda empresa nova (mesmo conteúdo do seed da
 * migração 0014). Mantidas em código para que a criação por server action semeie
 * igual ao backfill.
 */
export const BUILTIN_ROLES: {
  name: string;
  description: string;
  permissions: Permissions;
}[] = [
  {
    name: "Administrador",
    description: "Acesso total à empresa (gerencia usuários e roles).",
    permissions: {
      dashboard: ["ver"],
      chat: ["ver"],
      agentes: ["ver", "gerenciar"],
      conhecimento: ["ver", "editar", "gerenciar"],
      personalizar: ["ver", "editar", "gerenciar"],
      usuarios: ["ver", "gerenciar"],
    },
  },
  {
    name: "Membro",
    description: "Acesso de uso ao Jarvis.",
    permissions: {
      dashboard: ["ver"],
      chat: ["ver"],
      agentes: ["ver"],
      conhecimento: ["ver"],
      personalizar: ["ver"],
    },
  },
];

/** Garante superadmin; lança se não for. Chame em TODA ação/consulta de Empresas. */
export async function assertSuperadmin(): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx.isSuperadmin) throw new Error("Acesso restrito ao superadmin.");
}

/** Todas as empresas com contagem de membros e roles (superadmin). */
export async function listCompanies(): Promise<CompanySummary[]> {
  await assertSuperadmin();
  const admin = createAdminClient();
  const [companiesRes, profilesRes, rolesRes] = await Promise.all([
    admin.from("companies").select("id, name, created_at").order("created_at"),
    admin.from("profiles").select("company_id"),
    admin.from("roles").select("company_id"),
  ]);

  const count = (rows: { company_id: string | null }[] | null) => {
    const map = new Map<string, number>();
    (rows ?? []).forEach((r) => {
      if (r.company_id) map.set(r.company_id, (map.get(r.company_id) ?? 0) + 1);
    });
    return map;
  };
  const members = count(profilesRes.data);
  const roles = count(rolesRes.data);

  return (companiesRes.data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    createdAt: c.created_at,
    memberCount: members.get(c.id) ?? 0,
    roleCount: roles.get(c.id) ?? 0,
  }));
}

/** Cria a empresa e semeia as roles built-in. Retorna o id. */
export async function createCompany(name: string): Promise<string> {
  await assertSuperadmin();
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("companies")
    .insert({ name })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Falha ao criar empresa.");

  const companyId = data.id as string;
  const { error: rolesError } = await admin.from("roles").insert(
    BUILTIN_ROLES.map((r) => ({
      company_id: companyId,
      name: r.name,
      description: r.description,
      permissions: r.permissions,
      is_builtin: true,
    })),
  );
  if (rolesError) throw new Error(rolesError.message);

  return companyId;
}

/** Detalhe da empresa: membros (com nome da role) e roles. */
export async function getCompanyDetail(id: string): Promise<CompanyDetail | null> {
  await assertSuperadmin();
  const admin = createAdminClient();

  const [companyRes, membersRes, rolesRes] = await Promise.all([
    admin.from("companies").select("id, name, created_at").eq("id", id).maybeSingle(),
    admin
      .from("profiles")
      .select("id, email, role, role_id, roles ( name )")
      .eq("company_id", id)
      .order("created_at"),
    admin
      .from("roles")
      .select("id, name, description, permissions, is_builtin")
      .eq("company_id", id)
      .order("created_at"),
  ]);

  const company = companyRes.data;
  if (!company) return null;

  return {
    id: company.id,
    name: company.name,
    createdAt: company.created_at,
    members: (membersRes.data ?? []).map((m) => {
      const roleRow = Array.isArray(m.roles) ? m.roles[0] : m.roles;
      return {
        id: m.id,
        email: m.email ?? "",
        role: m.role,
        roleId: m.role_id ?? null,
        roleName: roleRow?.name ?? null,
      };
    }),
    roles: (rolesRes.data ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      permissions: r.permissions,
      isBuiltin: r.is_builtin,
    })),
  };
}
