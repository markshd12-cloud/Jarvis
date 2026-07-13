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
});

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

  return {
    hasData: true,
    brand: brand ?? null,
    totalFollowers,
    followersByBrand,
    series,
    posts,
    topMedia,
  };
}
