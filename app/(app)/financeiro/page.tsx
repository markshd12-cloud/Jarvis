import { redirect } from "next/navigation";

import { getSessionContext } from "@/lib/db/permissions";
import { can, landingHref } from "@/lib/permissions";

import { FinanceiroShell } from "./financeiro-shell";

// Módulo Financeiro (gestão de custos/DRE, independente do painel do Dashboard).
// Acesso pela permissão `financeiro` (matriz de roles) — só admin/financeiro.
export default async function FinanceiroPage() {
  const ctx = await getSessionContext();
  if (!can(ctx, "financeiro")) redirect(landingHref(ctx) ?? "/sem-acesso");
  return <FinanceiroShell />;
}
