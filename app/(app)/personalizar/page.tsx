import type { Metadata } from "next";

import { ManualSources } from "@/components/manual-sources";
import { listCompanies } from "@/lib/db/companies";
import { guardFeature } from "@/lib/db/permissions";
import { can } from "@/lib/permissions";
import { listManualSources } from "@/lib/db/sources";

export const metadata: Metadata = {
  title: "Personalizar | Jarvis",
};

export default async function PersonalizarPage() {
  const ctx = await guardFeature("personalizar");
  const canEdit = can(ctx, "personalizar", "editar");

  const sources = ctx.userId
    ? await listManualSources({
        userId: ctx.userId,
        companyId: ctx.companyId,
        isSuperadmin: ctx.isSuperadmin,
      })
    : [];

  // Superadmin marca quaisquer empresas → carrega todas. Usuário comum só marca a
  // própria (um checkbox "Minha empresa").
  const companies = ctx.isSuperadmin
    ? (await listCompanies()).map((c) => ({ id: c.id, name: c.name }))
    : [];

  return (
    <main>
      <section>
        <div className="sectionbox flex-col gap-6 py-10">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">Personalizar</h1>
            <p className="text-muted-foreground">
              Fontes fixas que você escreve ou envia como arquivo (HTML, CSV, TXT,
              MD, JSON). O Jarvis as trata como conhecimento — junto do Notion — nas
              respostas do chat.
            </p>
          </div>

          <ManualSources
            sources={sources}
            canEdit={canEdit}
            isSuperadmin={ctx.isSuperadmin}
            companies={companies}
            userCompanyId={ctx.companyId}
          />
        </div>
      </section>
    </main>
  );
}
