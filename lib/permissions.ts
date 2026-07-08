// Fundação de permissões — puro, SEM imports de servidor (usável no client e no
// server). Fonte da verdade dos "recursos" (funções do sidebar) e das ações.

export type Action = "ver" | "editar" | "gerenciar";

/** Mapa recurso -> ações concedidas. Ex.: { conhecimento: ["ver", "editar"] }. */
export type Permissions = Record<string, Action[]>;

export interface Feature {
  /** Chave do recurso (igual à chave usada em `permissions`). */
  key: string;
  label: string;
  href: string;
  /** Ações que fazem sentido para este recurso (colunas da matriz). */
  actions: Action[];
  /** Aparece no menu lateral (e é candidato a landing). `usuarios` é interno. */
  sidebar: boolean;
}

/**
 * Registro das funções do sidebar = linhas da matriz de permissão.
 * Adicionar um módulo novo aqui já o faz aparecer na matriz de roles.
 * A ORDEM define a prioridade de landing (primeiro item permitido).
 */
export const FEATURES: Feature[] = [
  { key: "dashboard", label: "Dashboard", href: "/dashboard", actions: ["ver"], sidebar: true },
  { key: "chat", label: "Bate-Papo", href: "/chat", actions: ["ver"], sidebar: true },
  {
    key: "agentes",
    label: "Agentes",
    href: "/agentes",
    actions: ["ver", "gerenciar"],
    sidebar: true,
  },
  {
    // Fontes externas (Notion, Drive, …). Vive em Configurações › Conexões —
    // não é item de menu lateral, mas continua na matriz de permissões.
    key: "conhecimento",
    label: "Conexões",
    href: "/dashboard",
    actions: ["ver", "editar", "gerenciar"],
    sidebar: false,
  },
  {
    key: "personalizar",
    label: "Personalizar",
    href: "/personalizar",
    actions: ["ver", "editar", "gerenciar"],
    sidebar: true,
  },
  {
    // Gestão de usuários/roles vive DENTRO de Empresas — não é item de menu.
    key: "usuarios",
    label: "Usuários",
    href: "/empresas",
    actions: ["ver", "gerenciar"],
    sidebar: false,
  },
];

export const ALL_ACTIONS: Action[] = ["ver", "editar", "gerenciar"];

/** Contexto mínimo para decidir acesso. */
export interface AccessContext {
  isSuperadmin: boolean;
  permissions: Permissions;
}

/** Superadmin pode tudo; senão, checa a ação no recurso. */
export function can(
  ctx: AccessContext,
  feature: string,
  action: Action = "ver",
): boolean {
  if (ctx.isSuperadmin) return true;
  return ctx.permissions[feature]?.includes(action) ?? false;
}

/** Quem pode gerenciar usuários/roles da empresa (área de gestão). */
export function canManageCompany(ctx: AccessContext): boolean {
  return can(ctx, "usuarios", "gerenciar");
}

/**
 * Primeira rota que o usuário PODE ver (na ordem de FEATURES). Superadmin cai no
 * Dashboard. `null` quando a role não concede nenhum módulo — o chamador decide
 * o destino (ex.: página "sem acesso").
 */
export function landingHref(ctx: AccessContext): string | null {
  if (ctx.isSuperadmin) return "/dashboard";
  const first = FEATURES.find((f) => f.sidebar && can(ctx, f.key));
  return first?.href ?? null;
}
