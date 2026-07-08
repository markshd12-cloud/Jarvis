import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import { CompanyUsersManager } from "@/components/company-users-manager";
import { RolesManager } from "@/components/roles-manager";
import { getCompanyDetail } from "@/lib/db/companies";
import { getSessionContext } from "@/lib/db/permissions";

export const metadata: Metadata = {
  title: "Empresa | Jarvis",
};

export default async function EmpresaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx.isSuperadmin) redirect("/dashboard");

  const { id } = await params;
  const company = await getCompanyDetail(id);
  if (!company) notFound();

  return (
    <main>
      <section>
        <div className="sectionbox flex-col gap-8 py-10">
          <div className="flex flex-col gap-1.5">
            <Link
              href="/empresas"
              className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeftIcon className="h-4 w-4" />
              Empresas
            </Link>
            <h1 className="text-2xl font-semibold tracking-tight">
              {company.name}
            </h1>
          </div>

          {/* Roles — matriz de permissões */}
          <RolesManager companyId={company.id} roles={company.roles} />

          {/* Usuários — cadastro por convite + atribuição de role */}
          <CompanyUsersManager
            companyId={company.id}
            members={company.members}
            roles={company.roles}
          />
        </div>
      </section>
    </main>
  );
}
