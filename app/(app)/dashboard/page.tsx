import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getSessionContext } from "@/lib/db/permissions";
import { can, landingHref } from "@/lib/permissions";
import { getMarketingDashboard } from "@/lib/marketing/dashboard";
import { getInstagramOverview } from "@/lib/marketing/social";
import { MARKETING_AD_ACCOUNTS } from "@/lib/marketing/config";
import { MarketingMetrics } from "@/components/marketing-metrics";
import { InstagramMetrics } from "@/components/instagram-metrics";

export const metadata: Metadata = {
  title: "Dashboard | Jarvis",
};

/** Primeiro valor de um param de query (Next entrega string | string[]). */
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // O Dashboard reúne módulos com permissões próprias. Hoje: visão geral
  // (`dashboard`) e o painel de Marketing/Meta Ads (`marketing`). Entra quem
  // tiver qualquer um; cada seção é montada conforme a permissão.
  const ctx = await getSessionContext();
  const canDashboard = can(ctx, "dashboard");
  const canMarketing = can(ctx, "marketing");
  if (!canDashboard && !canMarketing)
    redirect(landingHref(ctx) ?? "/sem-acesso");

  const sp = await searchParams;
  const brand = one(sp.brand);
  // Meta Ads (pago) e Instagram (orgânico) compartilham o filtro de marca e são
  // buscados em paralelo. O IG não usa período (snapshot de seguidores + posts).
  const [marketing, instagram] = canMarketing
    ? await Promise.all([
        getMarketingDashboard({
          range: one(sp.range),
          since: one(sp.since),
          until: one(sp.until),
          brand,
        }),
        getInstagramOverview({ brand }),
      ])
    : [null, null];
  const allBrands = MARKETING_AD_ACCOUNTS.map((a) => a.label);

  return (
    <main>
      <section>
        <div className="sectionbox flex-col gap-8 py-10">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
            <p className="text-muted-foreground">
              Visão de pessoas, vendas e financeiro. Conecte a Conta Azul em
              Configurações → Conexões para começar.
            </p>
          </div>

          {marketing ? (
            <MarketingMetrics data={marketing} allBrands={allBrands} />
          ) : null}

          {instagram ? (
            <>
              <hr className="border-border" />
              <InstagramMetrics data={instagram} />
            </>
          ) : null}
        </div>
      </section>
    </main>
  );
}
