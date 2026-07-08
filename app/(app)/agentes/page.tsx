import type { Metadata } from "next";

import { AgentsManager } from "@/components/agents-manager";
import { listAgents } from "@/lib/db/agents";
import { guardFeature } from "@/lib/db/permissions";
import { canManageCompany } from "@/lib/permissions";

export const metadata: Metadata = {
  title: "Agentes | Jarvis",
};

export default async function AgentesPage() {
  const ctx = await guardFeature("agentes");
  const agents = await listAgents();
  const canManage = ctx.isSuperadmin || canManageCompany(ctx);

  return (
    <main>
      <section>
        <div className="sectionbox flex-col gap-6 py-10">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">Agentes</h1>
            <p className="text-muted-foreground">
              IAs com personalidade própria. Cada agente responde sob a ótica dele
              (ex.: Marketing pensa tudo como campanha) usando o conhecimento da
              empresa.
            </p>
          </div>

          <AgentsManager agents={agents} canManage={canManage} />
        </div>
      </section>
    </main>
  );
}
