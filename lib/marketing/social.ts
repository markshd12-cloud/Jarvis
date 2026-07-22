/**
 * Instagram orgânico (leitura) — fonte de verdade do painel social.
 *
 * Lê `social_daily_insights` (snapshot diário de seguidores por conta) e
 * `social_media_insights` (posts recentes + engajamento) via service_role
 * (tabelas com RLS sem policies). Agrega em JS: o volume é pequeno (poucas
 * contas, ~25 posts por conta). GLOBAL: sem company_id; o gate é `can(ctx,
 * "marketing")` na página.
 *
 * Observação sobre a curva de crescimento: a Graph API não dá histórico de
 * seguidores, então a série é construída a partir dos snapshots diários — ela
 * começa "rasa" (um ponto) e ganha forma conforme o sync roda dia após dia.
 */
import { createAdminClient } from "@/lib/supabase/admin";

export interface IgBrandFollowers {
  brand: string;
  followers: number;
}

/** Total de seguidores no dia (soma de todas as contas). */
export interface IgFollowersPoint {
  date: string;
  followers: number;
}

export interface IgMedia {
  mediaId: string;
  brand: string;
  mediaType: string | null;
  mediaProductType: string | null;
  permalink: string | null;
  caption: string | null;
  reach: number | null;
  likes: number;
  comments: number;
  saved: number;
  shares: number;
  /** likes + comentários + salvos + compartilhamentos. */
  engagement: number;
  postedAt: string | null;
}

export interface InstagramOverview {
  hasData: boolean;
  /** Marca filtrada (null = todas). */
  brand: string | null;
  totalFollowers: number;
  /** Seguidores por marca, do maior para o menor. */
  followersByBrand: IgBrandFollowers[];
  /** Total de seguidores por dia (curva de crescimento). */
  series: IgFollowersPoint[];
  /** Agregado dos posts recentes considerados. */
  posts: {
    count: number;
    likes: number;
    comments: number;
    saved: number;
    shares: number;
    reach: number;
    engagement: number;
  };
  /** Melhores posts por engajamento (limite aplicado pelo chamador). */
  topMedia: IgMedia[];
  /** Desempenho por formato (Reels/Carrossel/Imagem/Vídeo). */
  byFormat: IgFormatStat[];
}

/** Agregado de desempenho por formato de conteúdo. */
export interface IgFormatStat {
  format: string;
  count: number;
  engagement: number;
  reach: number;
  /** Engajamento médio por post do formato. */
  avgEngagement: number;
}

interface DailyRow {
  account_id: string;
  brand: string;
  date: string;
  followers: number | null;
}

interface MediaRow {
  media_id: string;
  brand: string;
  media_type: string | null;
  media_product_type: string | null;
  permalink: string | null;
  caption: string | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  saved: number | null;
  shares: number | null;
  posted_at: string | null;
}

const emptyOverview = (brand: string | null): InstagramOverview => ({
  hasData: false,
  brand,
  totalFollowers: 0,
  followersByBrand: [],
  series: [],
  posts: { count: 0, likes: 0, comments: 0, saved: 0, shares: 0, reach: 0, engagement: 0 },
  topMedia: [],
  byFormat: [],
});

/** Rótulo do formato a partir de media_type/media_product_type. */
function formatLabel(mediaType: string | null, productType: string | null): string {
  if (productType === "REELS") return "Reels";
  if (mediaType === "CAROUSEL_ALBUM") return "Carrossel";
  if (mediaType === "VIDEO") return "Vídeo";
  return "Imagem";
}

/**
 * Visão consolidada do Instagram orgânico, opcionalmente filtrada por marca.
 * `topLimit` limita a lista de melhores posts (default 6).
 */
export async function getInstagramOverview(
  opts: { brand?: string; topLimit?: number } = {},
): Promise<InstagramOverview> {
  const { brand } = opts;
  const topLimit = opts.topLimit ?? 6;
  const admin = createAdminClient();

  let dailyQ = admin
    .from("social_daily_insights")
    .select("account_id, brand, date, followers")
    .eq("provider", "instagram")
    .order("date", { ascending: true });
  if (brand) dailyQ = dailyQ.eq("brand", brand);

  let mediaQ = admin
    .from("social_media_insights")
    .select(
      "media_id, brand, media_type, media_product_type, permalink, caption, reach, likes, comments, saved, shares, posted_at",
    )
    .eq("provider", "instagram")
    // Stories têm edge/métricas próprias (ver getInstagramStories) — fora do feed.
    .neq("media_product_type", "STORY")
    .order("posted_at", { ascending: false })
    .limit(200);
  if (brand) mediaQ = mediaQ.eq("brand", brand);

  const [{ data: dailyData }, { data: mediaData }] = await Promise.all([
    dailyQ,
    mediaQ,
  ]);

  const daily = (dailyData as DailyRow[] | null) ?? [];
  const media = (mediaData as MediaRow[] | null) ?? [];

  if (daily.length === 0 && media.length === 0) return emptyOverview(brand ?? null);

  // Seguidores por marca: último snapshot de cada conta, somado por marca.
  // (Uma marca pode ter mais de uma conta de IG — ex.: Everton.)
  const latestPerAccount = new Map<string, DailyRow>();
  for (const r of daily) {
    const prev = latestPerAccount.get(r.account_id);
    if (!prev || r.date > prev.date) latestPerAccount.set(r.account_id, r);
  }
  const followersMap = new Map<string, number>();
  for (const r of latestPerAccount.values()) {
    followersMap.set(r.brand, (followersMap.get(r.brand) ?? 0) + (r.followers ?? 0));
  }
  const followersByBrand: IgBrandFollowers[] = [...followersMap]
    .map(([b, followers]) => ({ brand: b, followers }))
    .sort((a, b) => b.followers - a.followers);
  const totalFollowers = followersByBrand.reduce((s, b) => s + b.followers, 0);

  // Curva de crescimento: total de seguidores por dia (soma das contas no dia).
  const byDate = new Map<string, number>();
  for (const r of daily) {
    byDate.set(r.date, (byDate.get(r.date) ?? 0) + (r.followers ?? 0));
  }
  const series: IgFollowersPoint[] = [...byDate]
    .map(([date, followers]) => ({ date, followers }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Posts: agregado + ranking por engajamento.
  const enriched: IgMedia[] = media.map((m) => {
    const likes = m.likes ?? 0;
    const comments = m.comments ?? 0;
    const saved = m.saved ?? 0;
    const shares = m.shares ?? 0;
    return {
      mediaId: m.media_id,
      brand: m.brand,
      mediaType: m.media_type,
      mediaProductType: m.media_product_type,
      permalink: m.permalink,
      caption: m.caption,
      reach: m.reach,
      likes,
      comments,
      saved,
      shares,
      engagement: likes + comments + saved + shares,
      postedAt: m.posted_at,
    };
  });

  const posts = enriched.reduce(
    (acc, m) => {
      acc.count += 1;
      acc.likes += m.likes;
      acc.comments += m.comments;
      acc.saved += m.saved;
      acc.shares += m.shares;
      acc.reach += m.reach ?? 0;
      acc.engagement += m.engagement;
      return acc;
    },
    { count: 0, likes: 0, comments: 0, saved: 0, shares: 0, reach: 0, engagement: 0 },
  );

  const topMedia = [...enriched]
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, topLimit);

  // Desempenho por formato (Reels/Carrossel/Imagem/Vídeo).
  const fmtMap = new Map<string, { count: number; engagement: number; reach: number }>();
  for (const m of enriched) {
    const f = formatLabel(m.mediaType, m.mediaProductType);
    const cur = fmtMap.get(f) ?? { count: 0, engagement: 0, reach: 0 };
    cur.count += 1;
    cur.engagement += m.engagement;
    cur.reach += m.reach ?? 0;
    fmtMap.set(f, cur);
  }
  const byFormat: IgFormatStat[] = [...fmtMap]
    .map(([format, s]) => ({
      format,
      count: s.count,
      engagement: s.engagement,
      reach: s.reach,
      avgEngagement: s.count ? s.engagement / s.count : 0,
    }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement);

  return {
    hasData: true,
    brand: brand ?? null,
    totalFollowers,
    followersByBrand,
    series,
    posts,
    topMedia,
    byFormat,
  };
}

// =========================================================================== //
// Audiência (demografia + melhor horário) — Fase 2                            //
// =========================================================================== //

export interface IgSegment {
  label: string;
  value: number;
}
export interface IgHour {
  hour: number; // 0-23
  value: number;
}
export interface InstagramAudience {
  hasData: boolean;
  brand: string | null;
  age: IgSegment[];
  gender: IgSegment[];
  city: IgSegment[];
  country: IgSegment[];
  /** Seguidores online por hora (0-23), quando disponível. */
  bestHours: IgHour[];
  capturedOn: string | null;
}

interface AudienceRowDb {
  account_id: string;
  breakdown: string;
  segment: string;
  value: number | null;
  captured_on: string;
}

const GENDER_LABEL: Record<string, string> = { F: "Feminino", M: "Masculino", U: "Não informado" };

/**
 * Demografia dos seguidores e melhor horário, do snapshot MAIS RECENTE por conta
 * (janela de 14 dias). Soma os segmentos entre contas da marca. Vazio até o sync
 * popular `social_audience` (precisa de ≥100 seguidores p/ a demografia).
 */
export async function getInstagramAudience(
  opts: { brand?: string } = {},
): Promise<InstagramAudience> {
  const { brand } = opts;
  const admin = createAdminClient();
  const desde = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);

  let q = admin
    .from("social_audience")
    .select("account_id, breakdown, segment, value, captured_on")
    .eq("provider", "instagram")
    .gte("captured_on", desde);
  if (brand) q = q.eq("brand", brand);
  const { data } = await q;
  const rows = (data as AudienceRowDb[] | null) ?? [];

  const empty: InstagramAudience = {
    hasData: false, brand: brand ?? null,
    age: [], gender: [], city: [], country: [], bestHours: [], capturedOn: null,
  };
  if (rows.length === 0) return empty;

  // Snapshot mais recente por (conta, breakdown) — evita somar dias diferentes.
  const latest = new Map<string, string>(); // `${account}|${breakdown}` → captured_on
  for (const r of rows) {
    const k = `${r.account_id}|${r.breakdown}`;
    const cur = latest.get(k);
    if (!cur || r.captured_on > cur) latest.set(k, r.captured_on);
  }

  const agg = new Map<string, Map<string, number>>(); // breakdown → segment → soma
  let capturedOn: string | null = null;
  for (const r of rows) {
    if (latest.get(`${r.account_id}|${r.breakdown}`) !== r.captured_on) continue;
    if (!capturedOn || r.captured_on > capturedOn) capturedOn = r.captured_on;
    let inner = agg.get(r.breakdown);
    if (!inner) agg.set(r.breakdown, (inner = new Map()));
    inner.set(r.segment, (inner.get(r.segment) ?? 0) + (r.value ?? 0));
  }

  const segs = (breakdown: string, topN?: number, relabel?: (s: string) => string): IgSegment[] => {
    const m = agg.get(breakdown);
    if (!m) return [];
    const out = [...m]
      .map(([label, value]) => ({ label: relabel ? relabel(label) : label, value }))
      .filter((s) => s.value > 0)
      .sort((a, b) => b.value - a.value);
    return topN ? out.slice(0, topN) : out;
  };

  const hoursMap = agg.get("hour");
  const bestHours: IgHour[] = hoursMap
    ? [...hoursMap]
        .map(([h, value]) => ({ hour: Number(h), value }))
        .filter((h) => Number.isFinite(h.hour))
        .sort((a, b) => a.hour - b.hour)
    : [];

  const age = segs("age");
  const gender = segs("gender", undefined, (s) => GENDER_LABEL[s] ?? s);
  const city = segs("city", 6);
  const country = segs("country", 6);
  const hasData =
    age.length + gender.length + city.length + country.length + bestHours.length > 0;

  return { hasData, brand: brand ?? null, age, gender, city, country, bestHours, capturedOn };
}

// =========================================================================== //
// Stories — Fase 3                                                            //
// =========================================================================== //

export interface IgStory {
  mediaId: string;
  brand: string;
  permalink: string | null;
  postedAt: string | null;
  reach: number | null;
  views: number | null;
  replies: number;
  navigation: number;
  interactions: number;
}
export interface InstagramStories {
  hasData: boolean;
  brand: string | null;
  count: number;
  reach: number;
  replies: number;
  navigation: number;
  items: IgStory[];
}

interface StoryRowDb {
  media_id: string;
  brand: string;
  permalink: string | null;
  reach: number | null;
  views: number | null;
  shares: number | null;
  metrics: Record<string, number> | null;
  posted_at: string | null;
}

/**
 * Stories capturados (social_media_insights, product_type STORY), mais recentes
 * primeiro. Métricas especiais (replies, navigation, interações) saem do jsonb
 * `metrics`. Só há dados enquanto o sync capturar stories ativos (≤24h).
 */
export async function getInstagramStories(
  opts: { brand?: string; limit?: number } = {},
): Promise<InstagramStories> {
  const { brand } = opts;
  const limit = opts.limit ?? 30;
  const admin = createAdminClient();

  let q = admin
    .from("social_media_insights")
    .select("media_id, brand, permalink, reach, views, shares, metrics, posted_at")
    .eq("provider", "instagram")
    .eq("media_product_type", "STORY")
    .order("posted_at", { ascending: false })
    .limit(limit);
  if (brand) q = q.eq("brand", brand);
  const { data } = await q;
  const rows = (data as StoryRowDb[] | null) ?? [];

  const empty: InstagramStories = {
    hasData: false, brand: brand ?? null, count: 0, reach: 0, replies: 0, navigation: 0, items: [],
  };
  if (rows.length === 0) return empty;

  const items: IgStory[] = rows.map((r) => {
    const m = r.metrics ?? {};
    return {
      mediaId: r.media_id,
      brand: r.brand,
      permalink: r.permalink,
      postedAt: r.posted_at,
      reach: r.reach,
      views: r.views,
      replies: m.replies ?? 0,
      navigation: m.navigation ?? 0,
      interactions: m.total_interactions ?? 0,
    };
  });

  return {
    hasData: true,
    brand: brand ?? null,
    count: items.length,
    reach: items.reduce((s, i) => s + (i.reach ?? 0), 0),
    replies: items.reduce((s, i) => s + i.replies, 0),
    navigation: items.reduce((s, i) => s + i.navigation, 0),
    items,
  };
}
