// Helpers puros de papel — SEM imports de servidor, para poderem ser usados
// tanto em Server Components/actions quanto em Client Components.

export type UserRole = "superadmin" | "admin" | "member";

/** Papel com acesso a gestão (empresa/usuários). Não inclui `member`. */
export function isManager(role: UserRole): boolean {
  return role === "superadmin" || role === "admin";
}
