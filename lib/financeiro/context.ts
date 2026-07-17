/**
 * Contexto/gate compartilhado do módulo financeiro. Toda rota chama `finContext()`
 * ANTES de qualquer acesso: verifica a permissão `financeiro` (admin) e resolve o
 * `companyId`. Assim o gate fica em um lugar só e as funções de `lib/financeiro/*`
 * recebem sempre um `companyId` já validado. Server-only.
 */
import "server-only";

import { getCompanyId } from "@/lib/db/company";
import { getSessionContext } from "@/lib/db/permissions";
import { can } from "@/lib/permissions";

export type FinGuard =
  | { ok: true; companyId: string }
  | { ok: false; status: 403 | 400; error: string };

export async function finContext(): Promise<FinGuard> {
  const ctx = await getSessionContext();
  if (!can(ctx, "financeiro"))
    return { ok: false, status: 403, error: "forbidden" };

  const companyId = await getCompanyId();
  if (!companyId)
    return { ok: false, status: 400, error: "sem empresa / Conta Azul desconectada" };

  return { ok: true, companyId };
}
