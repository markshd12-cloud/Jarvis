import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BuildingIcon, ChevronRightIcon } from "lucide-react";

import { CompanyCreateForm } from "@/components/company-create-form";
import { listCompanies } from "@/lib/db/companies";
import { getSessionContext } from "@/lib/db/permissions";

export const metadata: Metadata = {
  title: "Empresas | Jarvis",
};

export default async function EmpresasPage() {
  // Área exclusiva do superadmin (defesa em profundidade além do link oculto).
  const ctx = await getSessionContext();
  if (!ctx.isSuperadmin) redirect("/dashboard");

  const companies = await listCompanies();

  return (
    <main>
      <section>
        <div className="sectionbox flex-col gap-6 py-10">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1.5">
              <h1 className="text-2xl font-semibold tracking-tight">Empresas</h1>
              <p className="text-muted-foreground">
                Cada empresa é um espaço isolado, com seus próprios usuários e
                roles. Entre em uma para gerenciar acessos.
              </p>
            </div>
            <CompanyCreateForm />
          </div>

          <ul className="flex flex-col gap-2">
            {companies.map((company) => (
              <li key={company.id}>
                <Link
                  href={`/empresas/${company.id}`}
                  className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-primary/40"
                >
                  <div className="flex items-center gap-3">
                    <BuildingIcon className="h-5 w-5 shrink-0 text-primary" />
                    <div className="flex flex-col">
                      <span className="font-medium">{company.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {company.memberCount} usuário
                        {company.memberCount !== 1 ? "s" : ""} · {company.roleCount}{" "}
                        role{company.roleCount !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </div>
                  <ChevronRightIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
            {companies.length === 0 && (
              <li className="rounded-lg border border-border px-4 py-6 text-sm text-muted-foreground">
                Nenhuma empresa ainda.
              </li>
            )}
          </ul>
        </div>
      </section>
    </main>
  );
}
