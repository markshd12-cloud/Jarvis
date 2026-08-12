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
import { inclusiveDays, resolveRange, shiftIso } from "@/lib/marketing/dashboard";

/**
 * Filtro da tela aceito por TODOS os leitores do Instagram.
 *
 * Antes cada um tinha janela própria e fixa — overview usava o histórico
 * inteiro, funil 28 dias, audiência 14, stories 24h — enquanto o seletor de
 * período ficava no topo da tela sem governar nada. Era o mesmo defeito
 * corrigido no Meta Ads em 2026-08-11.
 */
export interface JanelaIg {
  brand?: string;
  range?: string;
  since?: string;
  until?: string;
}

/** O período pedido e o ANTERIOR de igual duração (base dos deltas). */
export interface PeriodoIg {
  since: string;
  until: string;
  antSince: string;
  antUntil: string;
}

/**
 * Resolve o filtro usando a MESMA função do Meta Ads (`resolveRange`), para as
 * duas abas nunca discordarem sobre que período está na tela.
 */
export function periodoIg(opts: JanelaIg): PeriodoIg {
  const { since, until } = resolveRange({
    range: opts.range,
    since: opts.since,
    until: opts.until,
  });
  // Período anterior de igual duração, imediatamente antes de `since`.
  const dias = inclusiveDays(since, until);
  const antUntil = shiftIso(since, -1);
  return { since, until, antSince: shiftIso(antUntil, -(dias - 1)), antUntil };
}

/**
 * Lê uma tabela inteira em páginas de 1.000.
 *
 * O PostgREST devolve no máximo 1.000 linhas por requisição e **não avisa** que
 * truncou — responde 200 com o pedaço. `social_audience` já tem 12.632 linhas, e
 * a leitura de 14 dias vinha silenciosamente cortada: parte dos breakdowns
 * sumia da tela sem erro, sem log e sem nada indicando que faltou.
 */
async function lerTudo<T>(
  /** Recebe a consulta JÁ montada, e só aplica o `range` de cada página. */
  montar: () => { range: (de: number, ate: number) => PromiseLike<{ data: unknown[] | null }> },
): Promise<T[]> {
  const PAGINA = 1000;
  const out: T[] = [];
  // Teto de segurança: 50 páginas = 50 mil linhas. Se estourar, o problema é a
  // consulta (janela larga demais), não a paginação.
  for (let p = 0; p < 50; p++) {
    const de = p * PAGINA;
    const { data } = await montar().range(de, de + PAGINA - 1);
    const lote = (data ?? []) as T[];
    out.push(...lote);
    if (lote.length < PAGINA) break;
  }
  return out;
}

export interface IgBrandFollowers {
  brand: string;
  followers: number;
}

/**
 * Um dia da série. `reach` e `engagement` entram junto com `followers`.
 *
 * O alcance JÁ ERA gravado em `social_daily_insights` desde sempre e nunca
 * aparecia em lugar nenhum — dado pago em chamada de API e jogado fora. O
 * engajamento vem dos posts do dia (`social_media_insights.posted_at`).
 */
export interface IgFollowersPoint {
  date: string;
  followers: number;
  reach: number;
  engagement: number;
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

/** Agregados do período ANTERIOR, para os deltas. `null` sem base. */
export interface IgAnterior {
  since: string;
  until: string;
  ganhoSeguidores: number;
  posts: number;
  engagement: number;
  reach: number;
}

export interface InstagramOverview {
  hasData: boolean;
  /** Marca filtrada (null = todas). */
  brand: string | null;
  /** Período exibido — resolvido do filtro da tela. */
  since: string;
  until: string;
  totalFollowers: number;
  /**
   * Ganho de seguidores NO PERÍODO.
   *
   * O delta se aplica a este número, não a `totalFollowers`: comparar totais
   * daria sempre "+0,1%" e esconderia se o mês foi bom ou ruim.
   */
  ganhoSeguidores: number;
  /** Seguidores por marca, do maior para o menor. */
  followersByBrand: IgBrandFollowers[];
  /** Total de seguidores por dia (curva de crescimento). */
  series: IgFollowersPoint[];
  /** Agregado dos posts do período. */
  posts: {
    count: number;
    likes: number;
    comments: number;
    saved: number;
    shares: number;
    reach: number;
    engagement: number;
  };
  /** Mesmos agregados no período anterior de igual duração. */
  anterior: IgAnterior | null;
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
  reach: number | null;
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

const emptyOverview = (brand: string | null, p: PeriodoIg): InstagramOverview => ({
  hasData: false,
  brand,
  since: p.since,
  until: p.until,
  totalFollowers: 0,
  ganhoSeguidores: 0,
  followersByBrand: [],
  series: [],
  posts: { count: 0, likes: 0, comments: 0, saved: 0, shares: 0, reach: 0, engagement: 0 },
  anterior: null,
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
  opts: JanelaIg & { topLimit?: number } = {},
): Promise<InstagramOverview> {
  const { brand } = opts;
  const topLimit = opts.topLimit ?? 6;
  const per = periodoIg(opts);
  const admin = createAdminClient();

  /**
   * A série diária vem do INÍCIO DO PERÍODO ANTERIOR até o fim do pedido.
   *
   * Precisa do anterior inteiro para calcular o ganho de lá (último menos
   * primeiro), e de um dia ANTES do `since` para o ganho do período pedido não
   * perder o crescimento ocorrido na virada.
   */
  const dailyDesde = shiftIso(per.antSince, -1);
  const dailyQ = () => {
    let q = admin
      .from("social_daily_insights")
      .select("account_id, brand, date, followers, reach")
      .eq("provider", "instagram")
      .gte("date", dailyDesde)
      .lte("date", per.until)
      .order("date", { ascending: true });
    if (brand) q = q.eq("brand", brand);
    return q;
  };

  const mediaQ = () => {
    let q = admin
      .from("social_media_insights")
      .select(
        "media_id, brand, media_type, media_product_type, permalink, caption, reach, likes, comments, saved, shares, posted_at",
      )
      .eq("provider", "instagram")
      // Stories têm edge/métricas próprias (ver getInstagramStories) — fora do feed.
      .neq("media_product_type", "STORY")
      .gte("posted_at", `${per.antSince}T00:00:00Z`)
      .lte("posted_at", `${per.until}T23:59:59Z`)
      .order("posted_at", { ascending: false });
    if (brand) q = q.eq("brand", brand);
    return q;
  };

  // Paginado: o `limit(200)` anterior descartava posts em silêncio quando o
  // período era largo, e o teto de 1.000 do PostgREST faria o mesmo.
  const [dailyTudo, mediaTudo] = await Promise.all([
    lerTudo<DailyRow>(dailyQ),
    lerTudo<MediaRow>(mediaQ),
  ]);

  // Recorta o que pertence ao período PEDIDO (o resto é base de comparação).
  const daily = dailyTudo.filter((r) => r.date >= per.since && r.date <= per.until);
  const media = mediaTudo.filter(
    (m) => (m.posted_at ?? "").slice(0, 10) >= per.since,
  );

  if (daily.length === 0 && media.length === 0) return emptyOverview(brand ?? null, per);

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

  // Curva por dia: seguidores (soma das contas), alcance (soma das contas) e
  // engajamento (soma dos posts publicados naquele dia).
  const byDate = new Map<string, IgFollowersPoint>();
  const ponto = (d: string) =>
    byDate.get(d) ?? { date: d, followers: 0, reach: 0, engagement: 0 };
  for (const r of daily) {
    const p = ponto(r.date);
    p.followers += r.followers ?? 0;
    p.reach += r.reach ?? 0;
    byDate.set(r.date, p);
  }
  for (const m of media) {
    const d = (m.posted_at ?? "").slice(0, 10);
    if (!d) continue;
    const p = ponto(d);
    p.engagement +=
      (m.likes ?? 0) + (m.comments ?? 0) + (m.saved ?? 0) + (m.shares ?? 0);
    byDate.set(d, p);
  }
  const series: IgFollowersPoint[] = [...byDate.values()].sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  /**
   * Ganho de seguidores num intervalo: total do último dia menos o do dia
   * ANTERIOR ao início.
   *
   * Medir do primeiro ao último dia DENTRO do intervalo perderia o crescimento
   * ocorrido entre a virada e o primeiro snapshot — o mesmo cuidado que
   * `ganhoSeguidores` em `metas.ts` já toma.
   */
  const ganhoEntre = (de: string, ate: string): number => {
    const totalNoDia = (d: string) =>
      dailyTudo.filter((r) => r.date === d).reduce((s, r) => s + (r.followers ?? 0), 0);
    const dias = [...new Set(dailyTudo.map((r) => r.date))].sort();
    const dentro = dias.filter((d) => d >= de && d <= ate);
    if (dentro.length === 0) return 0;
    const anteriores = dias.filter((d) => d < de);
    const partida = anteriores.length
      ? totalNoDia(anteriores[anteriores.length - 1])
      : totalNoDia(dentro[0]);
    return totalNoDia(dentro[dentro.length - 1]) - partida;
  };
  const ganhoSeguidores = ganhoEntre(per.since, per.until);

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

  // --- período anterior, para os deltas ----------------------------------- //
  const mediaAnt = mediaTudo.filter((m) => {
    const d = (m.posted_at ?? "").slice(0, 10);
    return d >= per.antSince && d <= per.antUntil;
  });
  const dailyAnt = dailyTudo.filter(
    (r) => r.date >= per.antSince && r.date <= per.antUntil,
  );
  const temAnterior = dailyAnt.length > 0 || mediaAnt.length > 0;
  const anterior: IgAnterior | null = temAnterior
    ? {
        since: per.antSince,
        until: per.antUntil,
        ganhoSeguidores: ganhoEntre(per.antSince, per.antUntil),
        posts: mediaAnt.length,
        engagement: mediaAnt.reduce(
          (s, m) =>
            s + (m.likes ?? 0) + (m.comments ?? 0) + (m.saved ?? 0) + (m.shares ?? 0),
          0,
        ),
        /**
         * Alcance dos POSTS, não o da conta.
         *
         * `posts.reach` (o número que aparece no card) soma o alcance de cada
         * publicação; `social_daily_insights.reach` é o alcance da CONTA no dia,
         * que é outra métrica e não deduplica entre posts. Comparar um com o
         * outro produziria um delta sem significado.
         */
        reach: mediaAnt.reduce((s, m) => s + (m.reach ?? 0), 0),
      }
    : null;

  return {
    hasData: true,
    brand: brand ?? null,
    since: per.since,
    until: per.until,
    ganhoSeguidores,
    anterior,
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
  opts: JanelaIg = {},
): Promise<InstagramAudience> {
  const { brand } = opts;
  const admin = createAdminClient();
  const per = periodoIg(opts);

  /**
   * Janela: 14 dias ANTES do fim do período pedido.
   *
   * A audiência é um SNAPSHOT (a composição de quem segue hoje), não um
   * acumulado do período — por isso a janela existe só para achar a captura
   * mais recente, e o leitor descarta o resto logo abaixo. 14 dias cobrem
   * folgadamente qualquer falha de sync.
   */
  const desde = shiftIso(per.until, -14);

  // PAGINADO: são ~600 linhas por dia × 14 dias. O `limit` implícito de 1.000 do
  // PostgREST cortava sem avisar, e breakdowns inteiros sumiam da tela.
  const rows = await lerTudo<AudienceRowDb>(() => {
    let q = admin
      .from("social_audience")
      .select("account_id, breakdown, segment, value, captured_on")
      .eq("provider", "instagram")
      .gte("captured_on", desde)
      .lte("captured_on", per.until)
      // Ordem estável é obrigatória ao paginar: sem ela o PostgREST pode
      // repetir ou pular linhas entre páginas.
      .order("captured_on", { ascending: false })
      .order("account_id", { ascending: true })
      .order("segment", { ascending: true });
    if (brand) q = q.eq("brand", brand);
    return q;
  });

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
  opts: JanelaIg & { limit?: number } = {},
): Promise<InstagramStories> {
  const { brand } = opts;
  const limit = opts.limit ?? 30;
  const per = periodoIg(opts);
  const admin = createAdminClient();

  /**
   * Agora segue o PERÍODO, não as últimas 24h.
   *
   * Story some do Instagram em 24h, mas o que o sync capturou fica no nosso
   * banco para sempre. A tela mostrava só o que ainda estava no ar e ignorava
   * todo o histórico já pago — em muitos dias isso significava "nenhum story",
   * quando havia dezenas gravados.
   */
  const rows = await lerTudo<StoryRowDb>(() => {
    let q = admin
      .from("social_media_insights")
      .select("media_id, brand, permalink, reach, views, shares, metrics, posted_at")
      .eq("provider", "instagram")
      .eq("media_product_type", "STORY")
      .gte("posted_at", `${per.since}T00:00:00Z`)
      .lte("posted_at", `${per.until}T23:59:59Z`)
      .order("posted_at", { ascending: false });
    if (brand) q = q.eq("brand", brand);
    return q;
  });

  const empty: InstagramStories = {
    hasData: false, brand: brand ?? null, count: 0, reach: 0, replies: 0, navigation: 0, items: [],
  };
  if (rows.length === 0) return empty;

  // `limit` agora corta só a LISTA exibida; os agregados (count/reach/replies)
  // usam o período inteiro. Antes limitava a própria consulta, e o total ficava
  // preso no teto — "30 stories" mesmo havendo 200.
  const todos: IgStory[] = rows.map((r) => {
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
    // Agregados sobre TODOS os stories do período; `items` é só a lista exibida.
    count: todos.length,
    reach: todos.reduce((s, i) => s + (i.reach ?? 0), 0),
    replies: todos.reduce((s, i) => s + i.replies, 0),
    navigation: todos.reduce((s, i) => s + i.navigation, 0),
    items: todos.slice(0, limit),
  };
}
