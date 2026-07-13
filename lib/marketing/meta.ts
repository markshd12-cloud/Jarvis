/**
 * Sync do Meta Ads → tabela-espelho `marketing_daily_insights` (GLOBAL).
 *
 * Puxa os insights DIÁRIOS a nível de conta ("dados gerais") de cada uma das 4
 * contas de anúncio (uma por marca) e grava uma linha por dia/marca, mais um
 * agregado geral (brand = null) somando as 4.
 *
 * O token vem do ENV (META_ENV), nunca do banco — mesmo padrão da service
 * account do Vertex. A linha em `marketing_connections` guarda só STATUS
 * (account_name + last_synced_at); o token nunca é persistido nem exposto.
 *
 * Rate limit: a Graph API devolve erro código 17 ("User request limit reached")
 * sob carga; tratamos com backoff exponencial.
 */
import {
  MARKETING_AD_ACCOUNTS,
  META_ENV,
  META_GRAPH_BASE,
  META_INSIGHT_FIELDS,
} from "@/lib/marketing/config";
import { daysAgo, today } from "@/lib/marketing/metrics";
import { createAdminClient } from "@/lib/supabase/admin";

/** Linha diária crua da Insights API (campos numéricos vêm como string). */
interface MetaInsightRow {
  date_start: string;
  date_stop: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  reach?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
}

/** Linha pronta para `marketing_daily_insights`. */
interface InsightRow {
  provider: "meta_ads";
  date: string;
  brand: string | null;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  reach: number | null;
  conversions: number | null;
  metrics: Record<string, number | null>;
}

export interface MetaSyncResult {
  accounts: number;
  days: number;
  upserted: number;
}

type GraphResponse = {
  data?: unknown[];
  paging?: { next?: string };
  error?: { code?: number; message?: string };
};

const num = (v: string | undefined): number | null =>
  v == null || v === "" ? null : Number(v);

const int = (v: string | undefined): number | null => {
  const n = num(v);
  return n == null ? null : Math.round(n);
};

// Janela retroativa padrão por sync (dias). Recaptura atribuições que a Meta
// ajusta depois; o upsert idempotente evita duplicar as linhas por-marca.
const LOOKBACK_DAYS = Number(process.env.META_SYNC_LOOKBACK_DAYS ?? 30);
// Teto do backfill manual (evita janela absurda por engano). ~13 meses.
const MAX_LOOKBACK_DAYS = 400;

/**
 * GET na Graph API com backoff no erro 17 (limite de requisições). Devolve o
 * JSON já parseado; lança nos demais erros.
 */
async function graphGet(url: string, attempt = 0): Promise<GraphResponse> {
  const res = await fetch(url);
  const json = (await res.json()) as GraphResponse;
  if (json.error) {
    // Código 17: limite atingido → espera crescente e tenta de novo (até 4x).
    if (json.error.code === 17 && attempt < 4) {
      await new Promise((r) => setTimeout(r, 2 ** attempt * 5_000));
      return graphGet(url, attempt + 1);
    }
    throw new Error(`Meta Graph API: ${json.error.message ?? "erro desconhecido"}`);
  }
  return json;
}

/**
 * Puxa todos os insights diários de uma conta na janela [since, until],
 * seguindo a paginação. Nível de conta (sem breakdown) = "dados gerais".
 */
async function fetchAccountInsights(
  adAccountId: string,
  since: string,
  until: string,
): Promise<MetaInsightRow[]> {
  const params = new URLSearchParams({
    access_token: META_ENV.accessToken,
    level: "account",
    time_increment: "1",
    fields: META_INSIGHT_FIELDS.join(","),
    time_range: JSON.stringify({ since, until }),
    limit: "500",
  });
  let url = `${META_GRAPH_BASE}/${adAccountId}/insights?${params}`;
  const rows: MetaInsightRow[] = [];
  for (;;) {
    const json = await graphGet(url);
    rows.push(...((json.data as MetaInsightRow[]) ?? []));
    const next = json.paging?.next;
    if (!next) break;
    url = next; // `next` já vem assinado com o access_token.
  }
  return rows;
}

/** Linha do banco a partir de um insight cru (mantém ctr/cpc/cpm em metrics). */
function toInsightRow(brand: string, r: MetaInsightRow): InsightRow {
  return {
    provider: "meta_ads",
    date: r.date_start,
    brand,
    spend: num(r.spend),
    impressions: int(r.impressions),
    clicks: int(r.clicks),
    reach: int(r.reach),
    conversions: null,
    metrics: { ctr: num(r.ctr), cpc: num(r.cpc), cpm: num(r.cpm) },
  };
}

/**
 * Sincroniza as 4 contas (Meta Ads) → marketing_daily_insights, mais o agregado
 * geral (brand = null). GLOBAL: sem company_id. Requer META_ACCESS_TOKEN no ENV.
 *
 * `lookbackDays` sobrescreve a janela padrão (ex.: backfill único de ~90 dias).
 * As datas saem no fuso da conta (São Paulo) — as contas são BR e a Insights API
 * reporta `date_start` no fuso da conta, então o `time_range` precisa casar com
 * ele; senão perto da meia-noite o dia sai trocado e não bate com as leituras.
 */
export async function syncMeta(
  opts: { lookbackDays?: number } = {},
): Promise<MetaSyncResult> {
  if (!META_ENV.accessToken)
    throw new Error("META_ACCESS_TOKEN ausente no ambiente.");

  const admin = createAdminClient();
  const lookback = Math.min(
    MAX_LOOKBACK_DAYS,
    Math.max(0, Math.trunc(opts.lookbackDays ?? LOOKBACK_DAYS)),
  );
  const since = daysAgo(lookback);
  const until = today();

  const brandRows: InsightRow[] = [];
  // Agregado geral por dia (soma das marcas). Chave = date.
  const totals = new Map<
    string,
    { spend: number; impressions: number; clicks: number; reach: number }
  >();

  for (const brand of MARKETING_AD_ACCOUNTS) {
    const insights = await fetchAccountInsights(brand.adAccountId, since, until);
    for (const r of insights) {
      brandRows.push(toInsightRow(brand.label, r));
      const t = totals.get(r.date_start) ?? {
        spend: 0,
        impressions: 0,
        clicks: 0,
        reach: 0,
      };
      t.spend += num(r.spend) ?? 0;
      t.impressions += int(r.impressions) ?? 0;
      t.clicks += int(r.clicks) ?? 0;
      t.reach += int(r.reach) ?? 0;
      totals.set(r.date_start, t);
    }
  }

  // Linhas do agregado geral (brand = null) com métricas derivadas.
  const aggRows: InsightRow[] = [...totals].map(([date, t]) => ({
    provider: "meta_ads",
    date,
    brand: null,
    spend: t.spend,
    impressions: t.impressions,
    clicks: t.clicks,
    reach: t.reach,
    conversions: null,
    metrics: {
      ctr: t.impressions ? (t.clicks / t.impressions) * 100 : null,
      cpc: t.clicks ? t.spend / t.clicks : null,
      cpm: t.impressions ? (t.spend / t.impressions) * 1000 : null,
    },
  }));

  // Por-marca: upsert idempotente (brand não-nulo deduplica no unique).
  if (brandRows.length) {
    const { error } = await admin
      .from("marketing_daily_insights")
      .upsert(brandRows, { onConflict: "provider,date,brand" });
    if (error)
      throw new Error(`upsert marketing_daily_insights: ${error.message}`);
  }

  // Agregado: o unique NÃO deduplica brand IS NULL (NULL é distinto em Postgres),
  // então substituímos a janela — apaga os nulos do período e reinsere.
  await admin
    .from("marketing_daily_insights")
    .delete()
    .eq("provider", "meta_ads")
    .is("brand", null)
    .gte("date", since)
    .lte("date", until);
  if (aggRows.length) {
    const { error } = await admin
      .from("marketing_daily_insights")
      .insert(aggRows);
    if (error)
      throw new Error(`insert agregado marketing_daily_insights: ${error.message}`);
  }

  // Marca a conexão como ativa (só status; token continua no ENV).
  await admin.from("marketing_connections").upsert(
    {
      provider: "meta_ads",
      account_name: `Meta Ads · ${MARKETING_AD_ACCOUNTS.length} contas`,
      last_synced_at: new Date().toISOString(),
    },
    { onConflict: "provider" },
  );

  return {
    accounts: MARKETING_AD_ACCOUNTS.length,
    days: totals.size,
    upserted: brandRows.length + aggRows.length,
  };
}
