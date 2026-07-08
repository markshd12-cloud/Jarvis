import type { Metadata } from "next";

import { guardFeature } from "@/lib/db/permissions";

export const metadata: Metadata = {
  title: "Dashboard | Jarvis",
};

export default async function DashboardPage() {
  await guardFeature("dashboard");

  return (
    <main>
      <section>
        <div className="sectionbox flex-col gap-6 py-10">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
            <p className="text-muted-foreground">
              Visão de pessoas, vendas e financeiro. Conecte a Conta Azul em
              Configurações → Conexões para começar.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
