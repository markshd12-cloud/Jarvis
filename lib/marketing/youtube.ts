/**
 * YouTube — Nível A (dados PÚBLICOS via Data API v3). Sync + leitura.
 *
 * Auth: REUSA a service account do Vertex com escopo `youtube.readonly` (ver
 * `lib/google/auth.ts`). A doc do Google diz que YouTube "não suporta service
 * accounts", mas para LEITURA PÚBLICA (canal/vídeo por id) funciona — validado ao
 * vivo em 2026-07-21. Sem API key, sem segredo novo.
 *
 * Armazenamento: REUSA as tabelas do Instagram (nada de tabela nova) —
 *  - `social_daily_insights` (provider='youtube'): snapshot diário do canal.
 *  - `social_media_insights` (provider='youtube'): métricas por vídeo.
 *
 * ⚠️ A API NÃO dá histórico de inscritos (igual ao IG): a curva de crescimento é
 * construída a partir dos snapshots diários — começa rasa e ganha forma a cada sync.
 * ⚠️ `viewCount` do canal é o total ACUMULADO (vitalício), não views do dia.
 *
 * Cota: ~3 unidades por canal/sync (channels + playlistItems + videos) de 10.000/dia.
 */
import "server-only";

import { getGoogleAccessToken } from "@/lib/google/auth";
import { MARKETING_BRANDS } from "@/lib/marketing/config";
import { today } from "@/lib/marketing/metrics";
import { createAdminClient } from "@/lib/supabase/admin";

const SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
const API = "https://youtube.googleapis.com/youtube/v3";
/** Vídeos recentes puxados por canal a cada sync. */
const MAX_VIDEOS = 25;
/** Heurística de Shorts: a API não expõe o formato; duração ≤60s é o melhor proxy. */
const SHORT_MAX_SEG = 60;

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Canais configurados (marca → channelId), pulando marcas sem canal. */
function canais(brand?: string): { brand: string; channelId: string }[] {
  return Object.values(MARKETING_BRANDS)
    .filter((b) => b.youtube && (!brand || b.label === brand))
    .map((b) => ({ brand: b.label, channelId: b.youtube as string }));
}

async function ytGet(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const token = await getGoogleAccessToken(SCOPE);
  const q = new URLSearchParams(params);
  const res = await fetch(`${API}/${path}?${q}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const json = (await res.json()) as Record<string, unknown> & {
    error?: { message?: string };
  };
  if (!res.ok || json.error) throw new Error(json.error?.message ?? `YouTube HTTP ${res.status}`);
  return json;
}

/** Duração ISO-8601 (PT2H22M44S) → segundos. */
function duracaoSeg(iso: string): number {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso ?? "");
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

// ================================ SYNC ===================================== //

export interface YoutubeSyncResult {
  channels: number;
  videos: number;
  errors: string[];
}

interface ChannelNode {
  id: string;
  snippet?: { title?: string };
  statistics?: { subscriberCount?: string; viewCount?: string; videoCount?: string };
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
}
interface VideoNode {
  id: string;
  snippet?: {
    title?: string;
    publishedAt?: string;
    thumbnails?: Record<string, { url?: string }>;
  };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  contentDetails?: { duration?: string };
}

/** Melhor thumbnail disponível (a API nem sempre traz todos os tamanhos). */
function thumbUrl(v: VideoNode): string | null {
  const t = v.snippet?.thumbnails ?? {};
  return t.medium?.url ?? t.high?.url ?? t.standard?.url ?? t.default?.url ?? null;
}

/**
 * Sincroniza os canais configurados. Cada canal é isolado: um que falhe não
 * impede os outros (o erro vai para `errors[]`, como no sync do Instagram).
 */
export async function syncYoutube(): Promise<YoutubeSyncResult> {
  const admin = createAdminClient();
  const dia = today();
  const errors: string[] = [];
  let channels = 0;
  let videos = 0;

  for (const { brand, channelId } of canais()) {
    try {
      const ch = (await ytGet("channels", {
        part: "snippet,statistics,contentDetails",
        id: channelId,
      })) as { items?: ChannelNode[] };
      const c = ch.items?.[0];
      if (!c) {
        errors.push(`${brand}: canal ${channelId} não encontrado`);
        continue;
      }

      // Snapshot diário do canal (inscritos + views acumuladas).
      const { error: e1 } = await admin.from("social_daily_insights").upsert(
        {
          provider: "youtube",
          account_id: channelId,
          brand,
          date: dia,
          followers: num(c.statistics?.subscriberCount),
          views: num(c.statistics?.viewCount),
          metrics: { videoCount: num(c.statistics?.videoCount) ?? 0 },
        },
        { onConflict: "provider,account_id,date" },
      );
      if (e1) errors.push(`${brand} snapshot: ${e1.message}`);
      channels++;

      // Vídeos recentes: playlist de uploads → ids → estatísticas.
      const uploads = c.contentDetails?.relatedPlaylists?.uploads;
      if (!uploads) {
        errors.push(`${brand}: canal sem playlist de uploads`);
        continue;
      }
      const pl = (await ytGet("playlistItems", {
        part: "contentDetails",
        playlistId: uploads,
        maxResults: String(MAX_VIDEOS),
      })) as { items?: { contentDetails?: { videoId?: string } }[] };
      const ids = (pl.items ?? [])
        .map((i) => i.contentDetails?.videoId)
        .filter((x): x is string => !!x);
      if (ids.length === 0) continue;

      const vd = (await ytGet("videos", {
        part: "snippet,statistics,contentDetails",
        id: ids.join(","),
      })) as { items?: VideoNode[] };

      const rows = (vd.items ?? []).map((v) => {
        const seg = duracaoSeg(v.contentDetails?.duration ?? "");
        return {
          provider: "youtube",
          media_id: v.id,
          account_id: channelId,
          brand,
          media_type: "VIDEO",
          // Sem campo de formato na API → duração como proxy (ver SHORT_MAX_SEG).
          media_product_type: seg > 0 && seg <= SHORT_MAX_SEG ? "SHORTS" : "VIDEO",
          permalink: `https://www.youtube.com/watch?v=${v.id}`,
          caption: (v.snippet?.title ?? "").slice(0, 280) || null,
          reach: null,
          views: num(v.statistics?.viewCount),
          likes: num(v.statistics?.likeCount),
          comments: num(v.statistics?.commentCount),
          saved: null,
          shares: null,
          // `social_media_insights` não tem coluna de thumbnail; guardar no jsonb
          // evita uma migration só para isso.
          metrics: { duracaoSeg: seg, thumb: thumbUrl(v) },
          posted_at: v.snippet?.publishedAt ?? null,
        };
      });

      if (rows.length) {
        const { error: e2 } = await admin
          .from("social_media_insights")
          .upsert(rows, { onConflict: "provider,media_id" });
        if (e2) errors.push(`${brand} vídeos: ${e2.message}`);
        else videos += rows.length;
      }
    } catch (e) {
      errors.push(`${brand} (${channelId}): ${msg(e)}`);
    }
  }

  return { channels, videos, errors };
}

// =============================== LEITURA =================================== //

export interface YtChannel {
  brand: string;
  subscribers: number;
  views: number;
  videoCount: number;
}
export interface YtPoint {
  date: string;
  subscribers: number;
}
export interface YtVideo {
  videoId: string;
  brand: string;
  title: string;
  permalink: string;
  views: number;
  likes: number;
  comments: number;
  duracaoSeg: number;
  isShort: boolean;
  postedAt: string | null;
  /** Miniatura do vídeo (null se a API não trouxe). */
  thumb: string | null;
  /** (likes + comentários) / views — em %. */
  engajamento: number;
}
export interface YtFormatStat {
  format: string;
  count: number;
  views: number;
  avgViews: number;
}
export interface YoutubeOverview {
  hasData: boolean;
  brand: string | null;
  totalSubscribers: number;
  totalViews: number;
  channels: YtChannel[];
  series: YtPoint[];
  topVideos: YtVideo[];
  byFormat: YtFormatStat[];
}

const emptyYt = (brand: string | null): YoutubeOverview => ({
  hasData: false, brand, totalSubscribers: 0, totalViews: 0,
  channels: [], series: [], topVideos: [], byFormat: [],
});

interface DailyRow {
  account_id: string;
  brand: string;
  date: string;
  followers: number | null;
  views: number | null;
  metrics: { videoCount?: number } | null;
}
interface VideoRow {
  media_id: string;
  brand: string;
  caption: string | null;
  permalink: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  media_product_type: string | null;
  metrics: { duracaoSeg?: number; thumb?: string | null } | null;
  posted_at: string | null;
}

/**
 * Visão do YouTube (canais + vídeos), opcionalmente filtrada por marca. Lê das
 * tabelas sociais — vazio até o primeiro sync rodar.
 */
export async function getYoutubeOverview(
  opts: { brand?: string; topLimit?: number } = {},
): Promise<YoutubeOverview> {
  const { brand } = opts;
  const topLimit = opts.topLimit ?? 6;
  const admin = createAdminClient();

  let dailyQ = admin
    .from("social_daily_insights")
    .select("account_id, brand, date, followers, views, metrics")
    .eq("provider", "youtube")
    .order("date", { ascending: true });
  if (brand) dailyQ = dailyQ.eq("brand", brand);

  let videoQ = admin
    .from("social_media_insights")
    .select("media_id, brand, caption, permalink, views, likes, comments, media_product_type, metrics, posted_at")
    .eq("provider", "youtube")
    .order("posted_at", { ascending: false })
    .limit(200);
  if (brand) videoQ = videoQ.eq("brand", brand);

  const [{ data: d1 }, { data: d2 }] = await Promise.all([dailyQ, videoQ]);
  const daily = (d1 as DailyRow[] | null) ?? [];
  const vids = (d2 as VideoRow[] | null) ?? [];
  if (daily.length === 0 && vids.length === 0) return emptyYt(brand ?? null);

  // Último snapshot por canal → totais por marca.
  const latest = new Map<string, DailyRow>();
  for (const r of daily) {
    const prev = latest.get(r.account_id);
    if (!prev || r.date > prev.date) latest.set(r.account_id, r);
  }
  const channels: YtChannel[] = [...latest.values()]
    .map((r) => ({
      brand: r.brand,
      subscribers: r.followers ?? 0,
      views: r.views ?? 0,
      videoCount: r.metrics?.videoCount ?? 0,
    }))
    .sort((a, b) => b.subscribers - a.subscribers);
  const totalSubscribers = channels.reduce((s, c) => s + c.subscribers, 0);
  const totalViews = channels.reduce((s, c) => s + c.views, 0);

  // Curva de inscritos: soma dos canais por dia.
  const byDate = new Map<string, number>();
  for (const r of daily) byDate.set(r.date, (byDate.get(r.date) ?? 0) + (r.followers ?? 0));
  const series: YtPoint[] = [...byDate]
    .map(([date, subscribers]) => ({ date, subscribers }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const enriched: YtVideo[] = vids.map((v) => {
    const views = v.views ?? 0;
    const likes = v.likes ?? 0;
    const comments = v.comments ?? 0;
    return {
      videoId: v.media_id,
      brand: v.brand,
      title: v.caption ?? "(sem título)",
      permalink: v.permalink ?? `https://www.youtube.com/watch?v=${v.media_id}`,
      views,
      likes,
      comments,
      duracaoSeg: v.metrics?.duracaoSeg ?? 0,
      isShort: v.media_product_type === "SHORTS",
      postedAt: v.posted_at,
      thumb: v.metrics?.thumb ?? null,
      engajamento: views ? ((likes + comments) / views) * 100 : 0,
    };
  });

  const fmt = new Map<string, { count: number; views: number }>();
  for (const v of enriched) {
    const k = v.isShort ? "Shorts" : "Vídeo longo";
    const cur = fmt.get(k) ?? { count: 0, views: 0 };
    cur.count += 1;
    cur.views += v.views;
    fmt.set(k, cur);
  }
  const byFormat: YtFormatStat[] = [...fmt]
    .map(([format, s]) => ({
      format,
      count: s.count,
      views: s.views,
      avgViews: s.count ? s.views / s.count : 0,
    }))
    .sort((a, b) => b.avgViews - a.avgViews);

  return {
    hasData: true,
    brand: brand ?? null,
    totalSubscribers,
    totalViews,
    channels,
    series,
    topVideos: [...enriched].sort((a, b) => b.views - a.views).slice(0, topLimit),
    byFormat,
  };
}
