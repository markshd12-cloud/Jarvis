import { redirect } from "next/navigation";

import { DashboardShell } from "@/components/dashboard-shell";
import { getContaAzulStatus, getNotionStatus } from "@/lib/db/connections";
import { getSessionContext } from "@/lib/db/permissions";
import { getProfileSettings } from "@/lib/db/profile";
import { can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  // Defesa em profundidade (o proxy também protege).
  if (!claims) {
    redirect("/login");
  }

  const email = typeof claims.email === "string" ? claims.email : "Conta";
  const [profileSettings, ctx] = await Promise.all([
    getProfileSettings(),
    getSessionContext(),
  ]);

  // Conexões (Notion, Conta Azul, Drive, …) vivem em Configurações e são gated
  // por `conhecimento`.
  const canConnections = can(ctx, "conhecimento");
  const connections = canConnections
    ? {
        notion: await getNotionStatus(),
        contaAzul: await getContaAzulStatus(),
      }
    : null;

  return (
    <DashboardShell
      user={{ email }}
      access={{ isSuperadmin: ctx.isSuperadmin, permissions: ctx.permissions }}
      profileSettings={profileSettings}
      connections={connections}
    >
      {children}
    </DashboardShell>
  );
}
