/**
 * Instagram — FUNIL da conta (Fase 1), lido AO VIVO com cache (como o GA4).
 *
 * As métricas de conta (`reach`, `views`, `profile_views`, `website_clicks`,
 * `accounts_engaged`, `total_interactions`) só vêm como `metric_type=total_value`
 * (agregado do período, NÃO série por dia) — então não cabem nas colunas por-dia
 * de `social_daily_insights`. Leitura ao vivo (1 chamada/conta) + cache 10 min é
 * o encaixe certo. Server-only, GLOBAL (gate `can(ctx,"marketing")`).
 *
 * Mostra a jornada do orgânico: alcance → engajaram → visitaram o perfil →
 * clicaram no link da bio (tráfego IG→site), com as taxas de conversão.
 */
import "server-only";

import { cachedSwr } from "@/lib/cache/kv";
import { MARKETING_BRANDS, META_ENV, META_GRAPH_BASE } from "@/lib/marketing/config";
import { daysAgo, today } from "@/lib/marketing/metrics";

export interface InstagramFunnel {
  hasData: boolean;
  brand: string | null;
  since: string;
  until: string;
  // Volume
  views: number; // impressões
  totalInteractions: number;
  // Etapas do funil
  reach: number;
  accountsEngaged: number;
  profileViews: number;
  websiteClicks: number;
  // Taxas de conversão (0-1); null quando o denominador é zero.
  engajamentoRate: number | null; // accountsEngaged / reach
  perfilRate: number | null; // profileViews / reach
  cliqueRate: number | null; // websiteClicks / profileViews
  atualizadoEm: string;
  erro?: string;
}

/** Contas de IG (achatadas), opcionalmente filtradas por marca. */
function igAccounts(brand?: string | null): { brand: string; igId: string }[] {
  return Object.values(MARKETING_BRANDS)
    .filter((b) => !brand || b.label === brand)
    .flatMap((b) => b.instagram.map((igId) => ({ brand: b.label, igId })));
}

/** Meia-noite SP (AAAA-MM-DD) em epoch-segundos (SP = UTC-3). */
function spMidnightUnix(iso: string): number {
  return Math.floor(Date.parse(`${iso}T03:00:00Z`) / 1000);
}

interface InsightRow {
  name: string;
  total_value?: { value?: number };
}

const METRICS = "reach,views,profile_views,website_clicks,accounts_engaged,total_interactions";

/** Insights de conta (total_value) de UMA conta no período → mapa nome→valor. */
async function fetchFunnel(igId: string, since: string, until: string): Promise<Record<string, number>> {
  const q = new URLSearchParams({
    access_token: META_ENV.accessToken,
    metric: METRICS,
    period: "day",
    metric_type: "total_value",
    since: String(spMidnightUnix(since)),
    until: String(spMidnightUnix(until) + 86_400),
  });
  const res = await fetch(`${META_GRAPH_BASE}/${igId}/insights?${q}`, { cache: "no-store" });
  const json = (await res.json()) as { data?: InsightRow[]; error?: { message?: string } };
  if (json.error) throw new Error(json.error.message ?? "erro IG insights");
  const out: Record<string, number> = {};
  for (const d of json.data ?? []) out[d.name] = Number(d.total_value?.value) || 0;
  return out;
}

const TTL = 10 * 60_000;

async function computeFunnel(brand: string | null, since: string, until: string): Promise<InstagramFunnel> {
  const acc = { views: 0, reach: 0, profileViews: 0, websiteClicks: 0, accountsEngaged: 0, totalInteractions: 0 };
  // Sequencial p/ ser gentil com o rate limit (poucas contas).
  for (const { igId } of igAccounts(brand)) {
    const m = await fetchFunnel(igId, since, until);
    acc.views += m.views ?? 0;
    acc.reach += m.reach ?? 0;
    acc.profileViews += m.profile_views ?? 0;
    acc.websiteClicks += m.website_clicks ?? 0;
    acc.accountsEngaged += m.accounts_engaged ?? 0;
    acc.totalInteractions += m.total_interactions ?? 0;
  }
  const hasData = acc.reach > 0 || acc.views > 0;
  return {
    hasData,
    brand,
    since,
    until,
    views: acc.views,
    totalInteractions: acc.totalInteractions,
    reach: acc.reach,
    accountsEngaged: acc.accountsEngaged,
    profileViews: acc.profileViews,
    websiteClicks: acc.websiteClicks,
    engajamentoRate: acc.reach ? acc.accountsEngaged / acc.reach : null,
    perfilRate: acc.reach ? acc.profileViews / acc.reach : null,
    cliqueRate: acc.profileViews ? acc.websiteClicks / acc.profileViews : null,
    atualizadoEm: new Date().toISOString(),
  };
}

/**
 * Funil do Instagram (padrão: últimos 28 dias). Cache 10 min por (marca,
 * período), persistente. Degrada gracioso: falha → `hasData:false` + `erro`.
 */
export async function getInstagramFunnel(
  opts: { brand?: string | null; days?: number } = {},
): Promise<InstagramFunnel> {
  const brand = opts.brand ?? null;
  const since = daysAgo(Math.max(1, Math.trunc(opts.days ?? 28)));
  const until = today();

  const vazio = (erro?: string): InstagramFunnel => ({
    hasData: false, brand, since, until,
    views: 0, totalInteractions: 0, reach: 0, accountsEngaged: 0, profileViews: 0, websiteClicks: 0,
    engajamentoRate: null, perfilRate: null, cliqueRate: null,
    atualizadoEm: new Date().toISOString(), erro,
  });

  if (!META_ENV.accessToken) return vazio("META_ACCESS_TOKEN ausente no ambiente.");

  const compute = async (): Promise<InstagramFunnel> => {
    try {
      return await computeFunnel(brand, since, until);
    } catch (error) {
      console.error("[ig-funnel] falha:", (error as Error).message);
      return vazio((error as Error).message);
    }
  };
  return cachedSwr(`ig-funnel:${brand ?? "all"}:${since}:${until}`, TTL, compute, {
    cacheIf: (d) => d.hasData,
  });
}
