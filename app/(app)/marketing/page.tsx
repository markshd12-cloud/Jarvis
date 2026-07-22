import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getSessionContext } from "@/lib/db/permissions";
import { can, landingHref } from "@/lib/permissions";
import { getMarketingDashboard } from "@/lib/marketing/dashboard";
import {
  getInstagramOverview,
  getInstagramAudience,
  getInstagramStories,
} from "@/lib/marketing/social";
import { getInstagramFunnel } from "@/lib/marketing/instagram-funnel";
import { getGa4Overview } from "@/lib/marketing/ga4";
import { getMetaDetail, getMetaBreakdowns } from "@/lib/marketing/meta-detail";
import { MARKETING_AD_ACCOUNTS } from "@/lib/marketing/config";
import { MarketingMetrics } from "@/components/marketing-metrics";
import { MetaDetailMetrics } from "@/components/meta-detail-metrics";
import { MetaBreakdownsPanel } from "@/components/meta-breakdowns";
import { InstagramMetrics } from "@/components/instagram-metrics";
import { Ga4Metrics } from "@/components/ga4-metrics";

import { MarketingShell } from "./marketing-shell";

export const metadata: Metadata = { title: "Marketing | Jarvis" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Módulo Marketing — página dedicada (espelha o Financeiro): dock de sub-abas.
 * Cada painel pronto é buscado no servidor conforme a permissão e passado ao
 * shell como slot. Meta Ads + Instagram → `marketing`; GA4 → `ga4` (checkbox
 * próprio na matriz de roles).
 */
export default async function MarketingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getSessionContext();
  const canMarketing = can(ctx, "marketing");
  const canGa4 = can(ctx, "ga4");
  if (!canMarketing && !canGa4) redirect(landingHref(ctx) ?? "/sem-acesso");

  const sp = await searchParams;
  const brand = one(sp.brand);

  const [
    marketing,
    metaDetail,
    metaBreakdowns,
    instagram,
    igFunnel,
    igAudience,
    igStories,
    ga4,
  ] = await Promise.all([
    canMarketing
      ? getMarketingDashboard({
          range: one(sp.range),
          since: one(sp.since),
          until: one(sp.until),
          brand,
        })
      : Promise.resolve(null),
    canMarketing ? getMetaDetail({ brand }) : Promise.resolve(null),
    canMarketing ? getMetaBreakdowns({ brand }) : Promise.resolve(null),
    canMarketing ? getInstagramOverview({ brand }) : Promise.resolve(null),
    canMarketing ? getInstagramFunnel({ brand }) : Promise.resolve(null),
    canMarketing ? getInstagramAudience({ brand }) : Promise.resolve(null),
    canMarketing ? getInstagramStories({ brand }) : Promise.resolve(null),
    canGa4 ? getGa4Overview() : Promise.resolve(null),
  ]);
  const allBrands = MARKETING_AD_ACCOUNTS.map((a) => a.label);

  return (
    <MarketingShell
      meta={
        marketing ? (
          <div className="flex flex-col gap-8">
            <MarketingMetrics data={marketing} allBrands={allBrands} />
            {metaDetail ? (
              <>
                <hr className="border-border" />
                <MetaDetailMetrics data={metaDetail} />
              </>
            ) : null}
            {metaBreakdowns ? (
              <>
                <hr className="border-border" />
                <MetaBreakdownsPanel data={metaBreakdowns} />
              </>
            ) : null}
          </div>
        ) : null
      }
      instagram={
        instagram ? (
          <InstagramMetrics
            data={instagram}
            funnel={igFunnel}
            audience={igAudience}
            stories={igStories}
          />
        ) : null
      }
      ga4={ga4 ? <Ga4Metrics data={ga4} /> : null}
    />
  );
}
