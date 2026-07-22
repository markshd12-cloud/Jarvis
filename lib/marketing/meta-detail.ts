/**
 * Meta Ads — DETALHE por campanha / anúncio, lido AO VIVO (Fase 1 da expansão).
 *
 * Diferente do overview (que sincroniza o nível-conta p/ `marketing_daily_insights`
 * e o painel lê da tabela), o detalhe por-nível tem volume grande demais p/ um
 * sync diário. Então lê ao vivo da Insights API com cache de 10 min — mesmo ethos
 * do GA4. Para não estourar o rate limit (erro 17), pede o SUMMARY do período
 * (sem `time_increment`), já ordenado por gasto (`sort=spend_descending`) e com
 * `limit`, e usa backoff. Server-only, GLOBAL (gate `can(ctx,"marketing")`).
 *
 * Fase 1 entrega: top campanhas + top anúncios com CPL, custo por conversa (WPP)
 * e ROAS. Breakdowns (idade/plataforma/região) e criativo/qualidade são Fases 2-3.
 */
import "server-only";

import { cachedSwr } from "@/lib/cache/kv";
import {
  MARKETING_AD_ACCOUNTS,
  META_ACTIONS,
  META_DETAIL_FIELDS,
  META_ENV,
  META_GRAPH_BASE,
} from "@/lib/marketing/config";
import { daysAgo, today } from "@/lib/marketing/metrics";

// ------------------------------- tipos ------------------------------------- //

/** Ranking de qualidade da Meta, normalizado (Fase 3). undefined = "unknown". */
export type RankBucket = "acima" | "media" | "abaixo";

/** Linha de performance de uma campanha ou anúncio (agregada no período). */
export interface MetaPerformer {
  /** Chave estável p/ React (marca+nome). */
  key: string;
  /** id da campanha/anúncio na Meta (p/ buscar criativo, etc.). */
  id?: string;
  name: string;
  brand: string;
  /** Campanha-mãe (só p/ anúncios). */
  campaign?: string;
  /** Deep link p/ o Gerenciador de Anúncios da Meta (abre a campanha/anúncio). */
  url: string;
  // ---- Fase 3 (só anúncios) ----
  /** Miniatura do criativo (thumbnail_url). */
  thumbnailUrl?: string;
  /** Título do criativo (headline exibida). */
  title?: string;
  /** Rankings de qualidade da Meta (undefined quando "unknown"/sem volume). */
  quality?: RankBucket;
  engagementRank?: RankBucket;
  conversionRank?: RankBucket;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  conversations: number;
  purchases: number;
  conversionValue: number;
  ctr: number | null;
  /** Custo por lead (`spend/leads`). */
  cpl: number | null;
  /** Custo por conversa de WhatsApp (`spend/conversations`). */
  costPerConversation: number | null;
  /** ROAS de vendas (`conversionValue/spend`). */
  roas: number | null;
}

export interface MetaDetail {
  hasData: boolean;
  since: string;
  until: string;
  /** Marca filtrada (null = todas). */
  brand: string | null;
  campaigns: MetaPerformer[];
  ads: MetaPerformer[];
  atualizadoEm: string;
  /** Preenchido quando a API falhou (rate limit, token) — UI mostra aviso. */
  erro?: string;
}

// ------------------------------- graph ------------------------------------- //

interface MetaAction {
  action_type: string;
  value?: string;
}
interface DetailRow {
  campaign_id?: string;
  ad_id?: string;
  campaign_name?: string;
  ad_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  ctr?: string;
  actions?: MetaAction[];
  action_values?: MetaAction[];
  quality_ranking?: string;
  engagement_rate_ranking?: string;
  conversion_rate_ranking?: string;
}
type GraphResponse = {
  data?: DetailRow[];
  paging?: { next?: string };
  error?: { code?: number; message?: string };
};

const numOr0 = (v: string | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
function actionValue(list: MetaAction[] | undefined, type: string): number {
  const hit = list?.find((a) => a.action_type === type);
  return hit ? Number(hit.value) || 0 : 0;
}

/** GET com backoff no erro 17 (limite de requisições). Genérico p/ reuso. */
async function graphGet<T = GraphResponse>(url: string, attempt = 0): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const json = (await res.json()) as T & { error?: { code?: number; message?: string } };
  if (json.error) {
    if (json.error.code === 17 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 2 ** attempt * 4_000));
      return graphGet<T>(url, attempt + 1);
    }
    throw new Error(`Meta Graph API: ${json.error.message ?? "erro desconhecido"}`);
  }
  return json;
}

/** Normaliza o ranking de qualidade da Meta em 3 baldes (ou undefined). */
function normRank(v?: string): RankBucket | undefined {
  if (!v || v === "unknown") return undefined;
  if (v.startsWith("above")) return "acima";
  if (v === "average") return "media";
  if (v.startsWith("below")) return "abaixo";
  return undefined;
}

/** Insights de UMA conta num nível (campaign|ad), summary do período, top por gasto. */
async function fetchLevel(
  adAccountId: string,
  level: "campaign" | "ad",
  since: string,
  until: string,
  limit: number,
): Promise<DetailRow[]> {
  const params = new URLSearchParams({
    access_token: META_ENV.accessToken,
    level,
    fields: META_DETAIL_FIELDS[level].join(","),
    time_range: JSON.stringify({ since, until }),
    sort: "spend_descending",
    limit: String(limit),
  });
  const json = await graphGet(`${META_GRAPH_BASE}/${adAccountId}/insights?${params}`);
  return json.data ?? [];
}

/** Deep link p/ o Gerenciador de Anúncios (act= sem o prefixo `act_`). */
function adsManagerUrl(adAccountId: string, level: "campaign" | "ad", id?: string): string {
  const act = adAccountId.replace(/^act_/, "");
  const base = "https://adsmanager.facebook.com/adsmanager/manage";
  if (level === "ad")
    return `${base}/ads?act=${act}${id ? `&selected_ad_ids=${id}` : ""}`;
  return `${base}/campaigns?act=${act}${id ? `&selected_campaign_ids=${id}` : ""}`;
}

function toPerformer(
  brand: string,
  adAccountId: string,
  level: "campaign" | "ad",
  r: DetailRow,
): MetaPerformer {
  const spend = numOr0(r.spend);
  const leads = Math.round(actionValue(r.actions, META_ACTIONS.lead));
  const conversations = Math.round(actionValue(r.actions, META_ACTIONS.conversation));
  const purchases = Math.round(actionValue(r.actions, META_ACTIONS.purchase));
  const conversionValue = actionValue(r.action_values, META_ACTIONS.purchase);
  const name = (level === "ad" ? r.ad_name : r.campaign_name) ?? "—";
  const id = level === "ad" ? r.ad_id : r.campaign_id;
  return {
    key: `${brand}·${id ?? name}`,
    id,
    name,
    brand,
    campaign: level === "ad" ? r.campaign_name : undefined,
    url: adsManagerUrl(adAccountId, level, id),
    quality: level === "ad" ? normRank(r.quality_ranking) : undefined,
    engagementRank: level === "ad" ? normRank(r.engagement_rate_ranking) : undefined,
    conversionRank: level === "ad" ? normRank(r.conversion_rate_ranking) : undefined,
    spend,
    impressions: Math.round(numOr0(r.impressions)),
    clicks: Math.round(numOr0(r.clicks)),
    leads,
    conversations,
    purchases,
    conversionValue,
    ctr: r.ctr != null && r.ctr !== "" ? numOr0(r.ctr) : null,
    cpl: leads ? spend / leads : null,
    costPerConversation: conversations ? spend / conversations : null,
    roas: spend ? conversionValue / spend : null,
  };
}

/** Nó de criativo no batch `?ids=…&fields=creative{…}`. */
interface CreativeNode {
  creative?: { thumbnail_url?: string; title?: string; body?: string };
}

/**
 * Criativos (miniatura + título) de vários anúncios numa ÚNICA request
 * (`GET /?ids=id1,id2&fields=creative{...}`). Degrada gracioso: falha → mapa
 * vazio (os cards aparecem sem imagem). Fase 3.
 */
async function fetchCreatives(
  adIds: string[],
): Promise<Map<string, { thumbnailUrl?: string; title?: string }>> {
  const out = new Map<string, { thumbnailUrl?: string; title?: string }>();
  if (adIds.length === 0) return out;
  try {
    const params = new URLSearchParams({
      access_token: META_ENV.accessToken,
      ids: adIds.join(","),
      fields: "creative{thumbnail_url,title,body}",
    });
    const json = await graphGet<Record<string, CreativeNode>>(`${META_GRAPH_BASE}/?${params}`);
    for (const [id, node] of Object.entries(json)) {
      const c = node?.creative;
      if (c) out.set(id, { thumbnailUrl: c.thumbnail_url, title: c.title });
    }
  } catch (error) {
    console.error("[meta-detail] falha ao buscar criativos:", (error as Error).message);
  }
  return out;
}

// ------------------------------- compute ----------------------------------- //

const TOP_N = 10; // quantas campanhas/anúncios exibir após juntar as contas
const PER_ACCOUNT = 25; // teto por conta/nível (limita volume e rate limit)

async function computeDetail(brand: string | null, since: string, until: string): Promise<MetaDetail> {
  const accounts = brand
    ? MARKETING_AD_ACCOUNTS.filter((a) => a.label === brand)
    : MARKETING_AD_ACCOUNTS;

  const campaigns: MetaPerformer[] = [];
  const ads: MetaPerformer[] = [];
  // Sequencial (não paralelo) p/ ser gentil com o rate limit da Graph API.
  for (const acc of accounts) {
    const [c, a] = await Promise.all([
      fetchLevel(acc.adAccountId, "campaign", since, until, PER_ACCOUNT),
      fetchLevel(acc.adAccountId, "ad", since, until, PER_ACCOUNT),
    ]);
    for (const r of c) campaigns.push(toPerformer(acc.label, acc.adAccountId, "campaign", r));
    for (const r of a) ads.push(toPerformer(acc.label, acc.adAccountId, "ad", r));
  }

  const bySpend = (x: MetaPerformer, y: MetaPerformer) => y.spend - x.spend;
  const topCampaigns = campaigns.filter((c) => c.spend > 0).sort(bySpend).slice(0, TOP_N);
  const topAds = ads.filter((a) => a.spend > 0).sort(bySpend).slice(0, TOP_N);

  // Fase 3: anexa o criativo (miniatura + título) só dos anúncios exibidos.
  const creativos = await fetchCreatives(topAds.map((a) => a.id).filter((x): x is string => !!x));
  for (const a of topAds) {
    const c = a.id ? creativos.get(a.id) : undefined;
    if (c) {
      a.thumbnailUrl = c.thumbnailUrl;
      a.title = c.title;
    }
  }

  return {
    hasData: topCampaigns.length > 0 || topAds.length > 0,
    since,
    until,
    brand,
    campaigns: topCampaigns,
    ads: topAds,
    atualizadoEm: new Date().toISOString(),
  };
}

// ------------------------------- cache ------------------------------------- //

// Cache 10 min (SWR de 2 camadas: memória + Supabase). Ver `lib/cache/kv.ts`.
const TTL = 10 * 60_000;

/**
 * Top campanhas + anúncios ao vivo (padrão: últimos 30 dias). Cache 10 min por
 * (marca, período), compartilhado/persistente. Degrada gracioso: falha →
 * `hasData:false` + `erro` p/ a UI (e não cacheia o erro).
 */
export async function getMetaDetail(
  opts: { brand?: string | null; days?: number } = {},
): Promise<MetaDetail> {
  const brand = opts.brand ?? null;
  const since = daysAgo(Math.max(1, Math.trunc(opts.days ?? 30)));
  const until = today();

  if (!META_ENV.accessToken) {
    return {
      hasData: false, since, until, brand, campaigns: [], ads: [],
      atualizadoEm: new Date().toISOString(), erro: "META_ACCESS_TOKEN ausente no ambiente.",
    };
  }

  const compute = async (): Promise<MetaDetail> => {
    try {
      return await computeDetail(brand, since, until);
    } catch (error) {
      console.error("[meta-detail] falha ao ler Insights:", (error as Error).message);
      return {
        hasData: false, since, until, brand, campaigns: [], ads: [],
        atualizadoEm: new Date().toISOString(), erro: (error as Error).message,
      };
    }
  };
  return cachedSwr(`meta-detail:${brand ?? "all"}:${since}:${until}`, TTL, compute, {
    cacheIf: (d) => d.hasData,
  });
}

// =========================================================================== //
// Fase 2 — BREAKDOWNS (público e posicionamento)                              //
// =========================================================================== //

/** Um segmento de um breakdown (faixa etária, plataforma, região…). */
export interface BreakdownSegment {
  label: string;
  spend: number;
  leads: number;
  conversations: number;
  /** Custo por lead do segmento (`spend/leads`). */
  cpl: number | null;
}

export interface MetaBreakdowns {
  hasData: boolean;
  since: string;
  until: string;
  brand: string | null;
  age: BreakdownSegment[];
  gender: BreakdownSegment[];
  platform: BreakdownSegment[]; // publisher_platform × platform_position
  device: BreakdownSegment[];
  region: BreakdownSegment[]; // top por gasto
  atualizadoEm: string;
  erro?: string;
}

/** Linha crua de um breakdown (as dimensões vêm como campos no topo). */
interface BreakdownRow {
  spend?: string;
  actions?: MetaAction[];
  age?: string;
  gender?: string;
  publisher_platform?: string;
  platform_position?: string;
  impression_device?: string;
  region?: string;
}

/** Insights nível-conta com dimensões de breakdown (summary do período). */
async function fetchBreakdown(
  adAccountId: string,
  breakdowns: string[],
  since: string,
  until: string,
  opts: { sortBySpend?: boolean; limit?: number } = {},
): Promise<BreakdownRow[]> {
  const params = new URLSearchParams({
    access_token: META_ENV.accessToken,
    level: "account",
    fields: "spend,actions",
    breakdowns: breakdowns.join(","),
    time_range: JSON.stringify({ since, until }),
    limit: String(opts.limit ?? 300),
  });
  if (opts.sortBySpend) params.set("sort", "spend_descending");
  const json = await graphGet(`${META_GRAPH_BASE}/${adAccountId}/insights?${params}`);
  return (json.data as BreakdownRow[]) ?? [];
}

type Agg = { spend: number; leads: number; conversations: number };
const emptyAgg = (): Agg => ({ spend: 0, leads: 0, conversations: 0 });

function bump(map: Map<string, Agg>, label: string, r: BreakdownRow): void {
  if (!label) return;
  const a = map.get(label) ?? emptyAgg();
  a.spend += numOr0(r.spend);
  a.leads += Math.round(actionValue(r.actions, META_ACTIONS.lead));
  a.conversations += Math.round(actionValue(r.actions, META_ACTIONS.conversation));
  map.set(label, a);
}

function toSegments(map: Map<string, Agg>, topN?: number): BreakdownSegment[] {
  const segs = [...map.entries()]
    .map(([label, a]) => ({
      label,
      spend: a.spend,
      leads: a.leads,
      conversations: a.conversations,
      cpl: a.leads ? a.spend / a.leads : null,
    }))
    .filter((s) => s.spend > 0)
    .sort((x, y) => y.spend - x.spend);
  return topN ? segs.slice(0, topN) : segs;
}

const GENERO: Record<string, string> = {
  male: "Masculino",
  female: "Feminino",
  unknown: "Não informado",
};
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ") : s);

async function computeBreakdowns(
  brand: string | null,
  since: string,
  until: string,
): Promise<MetaBreakdowns> {
  const accounts = brand
    ? MARKETING_AD_ACCOUNTS.filter((a) => a.label === brand)
    : MARKETING_AD_ACCOUNTS;

  const age = new Map<string, Agg>();
  const gender = new Map<string, Agg>();
  const platform = new Map<string, Agg>();
  const device = new Map<string, Agg>();
  const region = new Map<string, Agg>();

  for (const acc of accounts) {
    // 1 request cobre idade E gênero (breakdown cruzado, agregado nos dois eixos).
    const [ageGender, plat, dev, reg] = await Promise.all([
      fetchBreakdown(acc.adAccountId, ["age", "gender"], since, until),
      fetchBreakdown(acc.adAccountId, ["publisher_platform", "platform_position"], since, until),
      fetchBreakdown(acc.adAccountId, ["impression_device"], since, until),
      fetchBreakdown(acc.adAccountId, ["region"], since, until, { sortBySpend: true, limit: 50 }),
    ]);
    for (const r of ageGender) {
      bump(age, r.age ?? "", r);
      bump(gender, GENERO[r.gender ?? ""] ?? cap(r.gender ?? ""), r);
    }
    for (const r of plat)
      bump(platform, `${cap(r.publisher_platform ?? "")} · ${cap(r.platform_position ?? "")}`, r);
    for (const r of dev) bump(device, cap(r.impression_device ?? ""), r);
    for (const r of reg) bump(region, r.region ?? "", r);
  }

  const ageSeg = toSegments(age).sort((a, b) => a.label.localeCompare(b.label)); // etária em ordem
  const out = {
    age: ageSeg,
    gender: toSegments(gender),
    platform: toSegments(platform, 8),
    device: toSegments(device),
    region: toSegments(region, 8),
  };
  const hasData = Object.values(out).some((s) => s.length > 0);
  return { hasData, since, until, brand, ...out, atualizadoEm: new Date().toISOString() };
}

/**
 * Breakdowns de público/posicionamento ao vivo (idade, gênero, plataforma,
 * dispositivo, região), padrão 30 dias. Cache 10 min por (marca, período),
 * compartilhado/persistente (ver `lib/cache/kv.ts`).
 */
export async function getMetaBreakdowns(
  opts: { brand?: string | null; days?: number } = {},
): Promise<MetaBreakdowns> {
  const brand = opts.brand ?? null;
  const since = daysAgo(Math.max(1, Math.trunc(opts.days ?? 30)));
  const until = today();

  const vazio = (erro?: string): MetaBreakdowns => ({
    hasData: false, since, until, brand,
    age: [], gender: [], platform: [], device: [], region: [],
    atualizadoEm: new Date().toISOString(), erro,
  });

  if (!META_ENV.accessToken) return vazio("META_ACCESS_TOKEN ausente no ambiente.");

  const compute = async (): Promise<MetaBreakdowns> => {
    try {
      return await computeBreakdowns(brand, since, until);
    } catch (error) {
      console.error("[meta-detail] falha nos breakdowns:", (error as Error).message);
      return vazio((error as Error).message);
    }
  };
  return cachedSwr(`meta-breakdowns:${brand ?? "all"}:${since}:${until}`, TTL, compute, {
    cacheIf: (d) => d.hasData,
  });
}
