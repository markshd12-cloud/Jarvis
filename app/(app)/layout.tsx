import { redirect } from "next/navigation";

import { DashboardShell } from "@/components/dashboard-shell";
import {
  getContaAzulStatus,
  getMarketingStatus,
  getNotionStatus,
} from "@/lib/db/connections";
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

  // Conexões vivem em Configurações. Notion/Conta Azul são gated por
  // `conhecimento`; o Meta Ads (marketing GLOBAL) por `marketing:gerenciar`.
  // A aba aparece se o usuário tiver qualquer uma das permissões; cada card só
  // é montado quando a permissão correspondente existe.
  const canConnections = can(ctx, "conhecimento");
  const canMarketing = can(ctx, "marketing", "gerenciar");
  const connections =
    canConnections || canMarketing
      ? {
          notion: canConnections ? await getNotionStatus() : null,
          contaAzul: canConnections ? await getContaAzulStatus() : null,
          marketing: canMarketing ? await getMarketingStatus() : null,
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
