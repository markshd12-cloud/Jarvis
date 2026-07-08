import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import {
  type AccessContext,
  type Action,
  can,
  canManageCompany,
  landingHref,
  type Permissions,
} from "@/lib/permissions";

export interface SessionContext extends AccessContext {
  userId: string | null;
  companyId: string | null;
  roleId: string | null;
  roleName: string | null;
}

const anonymous: SessionContext = {
  userId: null,
  companyId: null,
  roleId: null,
  roleName: null,
  isSuperadmin: false,
  permissions: {},
};

/**
 * Contexto de acesso do usuário autenticado: papel de plataforma (superadmin) +
 * permissões vindas da role da empresa. Uma consulta, reaproveitável no layout,
 * nos guards de página e nas server actions.
 */
export async function getSessionContext(): Promise<SessionContext> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return anonymous;

  const { data } = await supabase
    .from("profiles")
    .select("company_id, role, role_id, roles ( name, permissions )")
    .eq("id", userId)
    .maybeSingle();

  // `roles` pode vir como objeto (relação para-um) dependendo do embed.
  const roleRow = Array.isArray(data?.roles) ? data?.roles[0] : data?.roles;

  return {
    userId,
    companyId: data?.company_id ?? null,
    roleId: data?.role_id ?? null,
    roleName: (roleRow?.name as string | undefined) ?? null,
    isSuperadmin: data?.role === "superadmin",
    permissions: (roleRow?.permissions as Permissions | undefined) ?? {},
  };
}

/**
 * Autoriza gestão de usuários/roles de uma empresa: superadmin (qualquer) ou quem
 * tem `usuarios:gerenciar` na PRÓPRIA empresa. Lança se não puder.
 */
export async function assertCanManageCompany(companyId: string): Promise<void> {
  const ctx = await getSessionContext();
  if (ctx.isSuperadmin) return;
  if (ctx.companyId === companyId && canManageCompany(ctx)) return;
  throw new Error("Sem permissão para gerenciar esta empresa.");
}

/**
 * Guarda de página: se o usuário não tem a permissão, redireciona para a primeira
 * rota que ele PODE ver (ou /sem-acesso se a role não concede nada). Nunca aponta
 * para a própria rota bloqueada → sem loop. Retorna o contexto quando permitido.
 */
export async function guardFeature(
  feature: string,
  action: Action = "ver",
): Promise<SessionContext> {
  const ctx = await getSessionContext();
  if (!can(ctx, feature, action)) redirect(landingHref(ctx) ?? "/sem-acesso");
  return ctx;
}
