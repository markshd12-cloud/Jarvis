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
import { getYoutubeOverview } from "@/lib/marketing/youtube";
import { YoutubeMetrics } from "@/components/youtube-metrics";
import { getCac } from "@/lib/marketing/cac";
import { CacMetrics } from "@/components/cac-metrics";
import { getCompanyId } from "@/lib/db/company";
import { getGa4Overview, getGa4Realtime } from "@/lib/marketing/ga4";
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
 * Trava de segurança: a página aguarda TODAS as integrações antes de renderizar
 * (Promise.all). Sem isto, uma integração lenta/travada (ex.: CAC lendo o Conta
 * Azul do ano todo ao vivo) faz a página "carregar pra sempre". Aqui, se passar
 * de `ms`, a integração devolve `null` → a seção some, mas a página abre.
 */
function comTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T | null> {
  return Promise.race([
    p,
    new Promise<null>((resolve) =>
      setTimeout(() => {
        console.warn(`[marketing] '${label}' excedeu ${ms}ms — degradando para vazio.`);
        resolve(null);
      }, ms),
    ),
  ]);
}
const T_RAPIDO = 8_000; // leituras do nosso banco / cacheadas
const T_LENTO = 12_000; // leituras ao vivo (Conta Azul / Graph / GA4)

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
  // CAC expõe custo (inclusive do Comercial) → exige as DUAS permissões.
  // `can()` já libera superadmin automaticamente.
  const canCac = canMarketing && can(ctx, "financeiro");
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
    ga4Realtime,
    youtube,
    cac,
  ] = await Promise.all([
    canMarketing
      ? comTimeout(
          getMarketingDashboard({
            range: one(sp.range),
            since: one(sp.since),
            until: one(sp.until),
            brand,
          }),
          T_RAPIDO,
          "meta-overview",
        )
      : Promise.resolve(null),
    canMarketing ? comTimeout(getMetaDetail({ brand }), T_LENTO, "meta-detail") : Promise.resolve(null),
    canMarketing ? comTimeout(getMetaBreakdowns({ brand }), T_LENTO, "meta-breakdowns") : Promise.resolve(null),
    canMarketing ? comTimeout(getInstagramOverview({ brand }), T_RAPIDO, "ig-overview") : Promise.resolve(null),
    canMarketing ? comTimeout(getInstagramFunnel({ brand }), T_LENTO, "ig-funnel") : Promise.resolve(null),
    canMarketing ? comTimeout(getInstagramAudience({ brand }), T_RAPIDO, "ig-audience") : Promise.resolve(null),
    canMarketing ? comTimeout(getInstagramStories({ brand }), T_RAPIDO, "ig-stories") : Promise.resolve(null),
    canGa4 ? comTimeout(getGa4Overview(), T_LENTO, "ga4-overview") : Promise.resolve(null),
    canGa4 ? comTimeout(getGa4Realtime(), T_RAPIDO, "ga4-realtime") : Promise.resolve(null),
    canMarketing ? comTimeout(getYoutubeOverview({ brand }), T_RAPIDO, "youtube") : Promise.resolve(null),
    canCac
      ? comTimeout(
          getCompanyId().then((companyId) => (companyId ? getCac(companyId) : null)),
          T_LENTO,
          "cac",
        )
      : Promise.resolve(null),
  ]);
  const allBrands = MARKETING_AD_ACCOUNTS.map((a) => a.label);

  return (
    <MarketingShell
      meta={
        marketing ? (
          <div className="flex flex-col gap-8">
            <MarketingMetrics
              data={marketing}
              allBrands={allBrands}
              basePath="/marketing"
            />
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
      ga4={ga4 ? <Ga4Metrics data={ga4} realtime={ga4Realtime} /> : null}
      youtube={youtube ? <YoutubeMetrics data={youtube} /> : null}
      cac={cac ? <CacMetrics data={cac} /> : null}
    />
  );
}
