/**
 * YouTube Analytics API (Nível B) — dados do DONO do canal.
 *
 * O QUE ISTO RESOLVE: a Data API pública arredonda inscritos para 3 dígitos
 * significativos acima de 1.000, mesmo para o dono. O CPPEM marcava 387.000
 * parado havia semanas; aqui julho aparece como **382 ganhos e 767 perdidos** —
 * uma queda de 385 que o dado público escondia por completo.
 *
 * UMA AUTORIZAÇÃO COBRE TODOS OS CANAIS. Descoberto na prática: o parâmetro
 * `ids=channel==<id>` aceita QUALQUER canal que a conta autorizada administre —
 * o token obtido pelo Colégio lê o CPPEM Concursos sem problema. Não é preciso
 * uma conexão por canal, e o seletor de canal do Google (que não aparece para
 * contas de marca) deixa de importar.
 */
import "server-only";

import { cachedSwr } from "@/lib/cache/kv";

import { MARKETING_AD_ACCOUNTS } from "./config";
import { listarConexoes, tokenValido } from "./youtube-oauth";

const BASE = "https://youtubeanalytics.googleapis.com/v2/reports";
const DATA_API = "https://www.googleapis.com/youtube/v3";

/** Último dia da competência ('AAAA-MM' → 'AAAA-MM-DD'). */
function ultimoDia(competencia: string): string {
  const [a, m] = competencia.split("-").map(Number);
  return `${competencia}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

/** Hoje em São Paulo — o servidor é UTC e viraria o dia antes da operação. */
function hojeSP(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function diasAtras(n: number): string {
  const [a, m, d] = hojeSP().split("-").map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d - n + 1));
  return dt.toISOString().slice(0, 10);
}

/** Janela de análise. `dias` casa com as janelas do YouTube Studio. */
export interface Janela {
  inicio: string;
  fim: string;
}

/**
 * Janela por número de dias, terminando HOJE.
 *
 * A Analytics costuma levar ~2 dias para consolidar; o último dia da janela pode
 * vir baixo. Não cortamos: um dia parcial visível no gráfico é menos enganoso do
 * que uma janela que silenciosamente ignora o que aconteceu ontem.
 */
export function janelaDias(dias: number): Janela {
  return { inicio: diasAtras(dias), fim: hojeSP() };
}

/** Janela de uma competência, cortada em hoje quando o mês está em curso. */
export function janelaCompetencia(competencia: string): Janela {
  const fim = ultimoDia(competencia);
  const hoje = hojeSP();
  return { inicio: `${competencia}-01`, fim: fim > hoje ? hoje : fim };
}

// ============================== TIPOS ===================================== //

export interface ResumoCanal {
  views: number;
  minutosAssistidos: number;
  /** % médio do vídeo assistido. Proxy de qualidade do conteúdo. */
  retencao: number | null;
  /** Duração média assistida, em segundos. */
  duracaoMedia: number;
  ganhos: number;
  perdidos: number;
  /** ganhos − perdidos. É o que de fato move o tamanho do canal. */
  liquido: number;
  likes: number;
  dislikes: number;
  comentarios: number;
  compartilhamentos: number;
  playlists: number;
  /** Receita estimada **em BRL**. `null` quando o canal não é monetizado. */
  receita: number | null;
}

export interface PontoDia {
  data: string;
  views: number;
  minutos: number;
  ganhos: number;
  perdidos: number;
  liquido: number;
}

export interface Formato {
  /** 'Shorts' | 'Vídeos' | 'Lives' | 'Outros'. */
  tipo: string;
  views: number;
  minutos: number;
  ganhos: number;
}

export interface VideoAnalytics {
  videoId: string;
  titulo: string;
  thumb: string | null;
  permalink: string;
  publicadoEm: string | null;
  /** Vídeo de até 3 min é tratado como Short — mesma régua do painel público. */
  isShort: boolean;
  views: number;
  minutos: number;
  retencao: number | null;
  ganhos: number;
}

export interface Fatia {
  rotulo: string;
  views: number;
  minutos?: number;
}

export interface FaixaEtaria {
  faixa: string;
  masculino: number;
  feminino: number;
}

export interface DetalheCanal {
  channelId: string;
  marca: string;
  janela: Janela;
  resumo: ResumoCanal;
  serie: PontoDia[];
  formatos: Formato[];
  topVideos: VideoAnalytics[];
  trafego: Fatia[];
  buscas: Fatia[];
  demografia: FaixaEtaria[];
  paises: Fatia[];
  dispositivos: Fatia[];
  /** Views de quem já era inscrito × de quem não era. */
  inscritos: Fatia[];
}

// ============================ INFRAESTRUTURA ============================== //

/**
 * Um token qualquer serve para todos os canais — ver a nota no topo. Pegamos o
 * primeiro que renove com sucesso; conexões mortas são descartadas sozinhas pelo
 * `tokenValido` (que apaga a linha em `invalid_grant`).
 */
async function tokenDaConta(): Promise<string | null> {
  for (const c of await listarConexoes()) {
    try {
      return await tokenValido(c.channel_id);
    } catch {
      // conexão inválida — tenta a próxima
    }
  }
  return null;
}

/**
 * Uma consulta à Analytics. Devolve as linhas ou `[]`.
 *
 * NUNCA lança: esta tela faz ~11 consultas por canal, e uma dimensão indisponível
 * (demografia de canal pequeno, por exemplo) não pode derrubar as outras dez.
 */
async function consulta(
  token: string,
  channelId: string,
  janela: Janela,
  params: Record<string, string>,
): Promise<number[][] | string[][]> {
  const p = new URLSearchParams({
    ids: `channel==${channelId}`,
    startDate: janela.inicio,
    endDate: janela.fim,
    ...params,
  });
  try {
    const r = await fetch(`${BASE}?${p}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) {
      console.warn(`[yt-analytics] ${params.dimensions ?? params.metrics}: HTTP ${r.status}`);
      return [];
    }
    const j = (await r.json()) as { rows?: (number | string)[][] };
    return (j.rows ?? []) as number[][];
  } catch (e) {
    console.warn(`[yt-analytics] ${params.dimensions ?? params.metrics} falhou`, e);
    return [];
  }
}

/** Rótulos em português das origens de tráfego. */
const TRAFEGO: Record<string, string> = {
  SHORTS: "Feed de Shorts",
  YT_SEARCH: "Busca do YouTube",
  SUBSCRIBER: "Inscritos (feed/inscrições)",
  EXT_URL: "Sites externos",
  RELATED_VIDEO: "Vídeos sugeridos",
  BROWSE: "Tela inicial e explorar",
  NOTIFICATION: "Notificações",
  PLAYLIST: "Playlists",
  YT_CHANNEL: "Página do canal",
  NO_LINK_OTHER: "Direto / desconhecido",
  NO_LINK_EMBEDDED: "Player incorporado",
  END_SCREEN: "Tela final",
  ANNOTATION: "Cards e anotações",
  HASHTAGS: "Hashtags",
  YT_PLAYLIST_PAGE: "Página de playlist",
  CAMPAIGN_CARD: "Card de campanha",
  ADVERTISING: "Anúncios",
  SOUND_PAGE: "Página do áudio",
  IMMERSIVE: "Modo imersivo",
  PRODUCT_PAGE: "Página do produto",
  LIVE_REDIRECT: "Redirecionamento de live",
};

const FORMATO: Record<string, string> = {
  shorts: "Shorts",
  videoOnDemand: "Vídeos",
  liveStream: "Lives",
  creatorContentTypeUnspecified: "Não atribuído",
};

const DISPOSITIVO: Record<string, string> = {
  MOBILE: "Celular",
  DESKTOP: "Computador",
  TV: "TV",
  TABLET: "Tablet",
  GAME_CONSOLE: "Console",
  UNKNOWN_PLATFORM: "Desconhecido",
};

const PAIS: Record<string, string> = {
  BR: "Brasil", PT: "Portugal", US: "Estados Unidos", IN: "Índia", JP: "Japão",
  AO: "Angola", MZ: "Moçambique", AR: "Argentina", PY: "Paraguai", ES: "Espanha",
  DE: "Alemanha", FR: "França", GB: "Reino Unido", IT: "Itália", CA: "Canadá",
};

const FAIXA: Record<string, string> = {
  "age13-17": "13–17", "age18-24": "18–24", "age25-34": "25–34",
  "age35-44": "35–44", "age45-54": "45–54", "age55-64": "55–64",
  "age65-": "65+",
};

/**
 * Título, miniatura e duração dos vídeos — a Analytics devolve só o `videoId`.
 *
 * Usa a **Data API** com o mesmo token OAuth. Um único pedido cobre até 50 ids,
 * e vídeo removido simplesmente não volta na resposta (por isso o fallback para
 * o próprio id no chamador).
 */
async function metaDosVideos(
  token: string,
  ids: string[],
): Promise<Map<string, { titulo: string; thumb: string | null; publicadoEm: string | null; duracaoSeg: number }>> {
  const out = new Map<string, { titulo: string; thumb: string | null; publicadoEm: string | null; duracaoSeg: number }>();
  if (ids.length === 0) return out;
  try {
    const p = new URLSearchParams({
      part: "snippet,contentDetails",
      id: ids.slice(0, 50).join(","),
      maxResults: "50",
    });
    const r = await fetch(`${DATA_API}/videos?${p}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return out;
    const j = (await r.json()) as {
      items?: {
        id: string;
        snippet?: { title?: string; publishedAt?: string; thumbnails?: Record<string, { url?: string }> };
        contentDetails?: { duration?: string };
      }[];
    };
    for (const it of j.items ?? []) {
      const t = it.snippet?.thumbnails;
      out.set(it.id, {
        titulo: it.snippet?.title ?? it.id,
        thumb: t?.medium?.url ?? t?.default?.url ?? null,
        publicadoEm: it.snippet?.publishedAt ?? null,
        duracaoSeg: duracaoIso(it.contentDetails?.duration ?? ""),
      });
    }
  } catch (e) {
    console.warn("[yt-analytics] metaDosVideos falhou", e);
  }
  return out;
}

/** ISO-8601 de duração ('PT1M30S') → segundos. */
function duracaoIso(iso: string): number {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return 0;
  const [, d, h, mi, s] = m.map((v) => Number(v ?? 0));
  return d * 86400 + h * 3600 + mi * 60 + s;
}

// ============================== LEITURA =================================== //

/**
 * Tudo que a Analytics entrega para um canal numa janela — 11 consultas em
 * paralelo, mais uma à Data API pelos títulos.
 *
 * Em paralelo porque em série seriam ~11 idas ao Google somadas, o que estouraria
 * o timeout da página. Cada consulta degrada sozinha para lista vazia, então uma
 * dimensão ausente apaga a seção dela e nada mais.
 */
export async function detalheDoCanal(
  channelId: string,
  janela: Janela,
): Promise<DetalheCanal | null> {
  /**
   * Cache SWR de 2 camadas (memória + Supabase `cache_kv`), 30 min.
   *
   * São ~12 idas ao Google por canal, e sem cache elas rodavam A CADA
   * carregamento da página — a leitura estourava os 20s de timeout e o painel
   * aparecia vazio. A Analytics consolida os dados com ~2 dias de atraso, então
   * 30 min de validade não atrasa nada: o dado mais recente é o mesmo em duas
   * consultas no mesmo turno.
   *
   * A chave inclui a janela; janelas diferentes são resultados diferentes.
   * `cacheIf` evita gravar o `null` de "nenhuma conta conectada" — senão
   * conectar o canal não teria efeito visível por meia hora.
   */
  return cachedSwr(
    `yt-analytics:${channelId}:${janela.inicio}:${janela.fim}`,
    30 * 60_000,
    () => detalheDoCanalAoVivo(channelId, janela),
    { cacheIf: (d) => d !== null },
  );
}

async function detalheDoCanalAoVivo(
  channelId: string,
  janela: Janela,
): Promise<DetalheCanal | null> {
  const token = await tokenDaConta();
  if (!token) return null;

  const marca =
    MARKETING_AD_ACCOUNTS.find((b) => b.youtube === channelId)?.label ?? channelId;
  const q = (params: Record<string, string>) => consulta(token, channelId, janela, params);

  const [
    tot, rec, dia, fmt, vid, traf, busca, demo, pais, disp, insc,
  ] = await Promise.all([
    q({ metrics: "views,estimatedMinutesWatched,averageViewPercentage,averageViewDuration,subscribersGained,subscribersLost,likes,dislikes,comments,shares,videosAddedToPlaylists" }),
    // `currency` é OBRIGATÓRIO: sem ele a API responde em USD. Ver o Erro 2 em
    // docs/youtube-nivel-b-setup.md — dava diferença de 5x no valor exibido.
    q({ metrics: "estimatedRevenue", currency: "BRL" }),
    q({ dimensions: "day", metrics: "views,estimatedMinutesWatched,subscribersGained,subscribersLost" }),
    q({ dimensions: "creatorContentType", metrics: "views,estimatedMinutesWatched,subscribersGained" }),
    q({ dimensions: "video", metrics: "views,estimatedMinutesWatched,averageViewPercentage,subscribersGained", sort: "-views", maxResults: "10" }),
    q({ dimensions: "insightTrafficSourceType", metrics: "views,estimatedMinutesWatched", sort: "-views" }),
    q({ dimensions: "insightTrafficSourceDetail", metrics: "views", filters: "insightTrafficSourceType==YT_SEARCH", sort: "-views", maxResults: "10" }),
    q({ dimensions: "ageGroup,gender", metrics: "viewerPercentage" }),
    q({ dimensions: "country", metrics: "views", sort: "-views", maxResults: "6" }),
    q({ dimensions: "deviceType", metrics: "views", sort: "-views" }),
    q({ dimensions: "subscribedStatus", metrics: "views,estimatedMinutesWatched" }),
  ]);

  const t = (tot[0] ?? []) as number[];
  const [views = 0, minutos = 0, retencao = 0, durMedia = 0, ganhos = 0, perdidos = 0,
    likes = 0, dislikes = 0, comentarios = 0, shares = 0, playlists = 0] = t;

  const resumo: ResumoCanal = {
    views, minutosAssistidos: minutos,
    retencao: retencao || null,
    duracaoMedia: durMedia,
    ganhos, perdidos, liquido: ganhos - perdidos,
    likes, dislikes, comentarios, compartilhamentos: shares, playlists,
    // `rows: []` = canal não monetizado. Diferente de receita zero, que afirmaria
    // monetização com desempenho nulo.
    receita: (rec[0] as number[] | undefined)?.[0] ?? null,
  };

  const serie: PontoDia[] = (dia as (string | number)[][]).map((r) => ({
    data: String(r[0]),
    views: Number(r[1] ?? 0),
    minutos: Number(r[2] ?? 0),
    ganhos: Number(r[3] ?? 0),
    perdidos: Number(r[4] ?? 0),
    liquido: Number(r[3] ?? 0) - Number(r[4] ?? 0),
  }));

  const formatos: Formato[] = (fmt as (string | number)[][])
    .map((r) => ({
      tipo: FORMATO[String(r[0])] ?? String(r[0]),
      views: Number(r[1] ?? 0),
      minutos: Number(r[2] ?? 0),
      ganhos: Number(r[3] ?? 0),
    }))
    // "Não atribuído" só aparece se tiver views. Ele carrega os inscritos que o
    // YouTube não liga a nenhum conteúdo — relevante no total, mas uma barra de
    // zero views ao lado de Shorts e Vídeos só confunde.
    .filter((f) => f.views > 0 || f.tipo !== "Não atribuído")
    .sort((a, b) => b.views - a.views);

  const ids = (vid as (string | number)[][]).map((r) => String(r[0]));
  const metas = await metaDosVideos(token, ids);
  const topVideos: VideoAnalytics[] = (vid as (string | number)[][]).map((r) => {
    const id = String(r[0]);
    const m = metas.get(id);
    return {
      videoId: id,
      titulo: m?.titulo ?? id,
      thumb: m?.thumb ?? null,
      permalink: `https://www.youtube.com/watch?v=${id}`,
      publicadoEm: m?.publicadoEm ?? null,
      isShort: (m?.duracaoSeg ?? 0) > 0 && (m?.duracaoSeg ?? 0) <= 180,
      views: Number(r[1] ?? 0),
      minutos: Number(r[2] ?? 0),
      retencao: Number(r[3] ?? 0) || null,
      ganhos: Number(r[4] ?? 0),
    };
  });

  const trafego: Fatia[] = (traf as (string | number)[][])
    .map((r) => ({
      rotulo: TRAFEGO[String(r[0])] ?? String(r[0]),
      views: Number(r[1] ?? 0),
      minutos: Number(r[2] ?? 0),
    }))
    .filter((f) => f.views > 0);

  const buscas: Fatia[] = (busca as (string | number)[][])
    .map((r) => ({ rotulo: String(r[0]), views: Number(r[1] ?? 0) }))
    .filter((f) => f.views > 0);

  /**
   * Demografia vem como (faixa, gênero, %) — uma linha por combinação. A tela
   * quer uma linha por FAIXA, com os dois gêneros lado a lado, para dar a leitura
   * "quem assiste este canal" numa passada de olho.
   */
  const porFaixa = new Map<string, FaixaEtaria>();
  for (const r of demo as (string | number)[][]) {
    const chave = FAIXA[String(r[0])] ?? String(r[0]);
    const f = porFaixa.get(chave) ?? { faixa: chave, masculino: 0, feminino: 0 };
    if (String(r[1]) === "male") f.masculino = Number(r[2] ?? 0);
    else if (String(r[1]) === "female") f.feminino = Number(r[2] ?? 0);
    porFaixa.set(chave, f);
  }
  const demografia = [...porFaixa.values()].sort((a, b) => a.faixa.localeCompare(b.faixa));

  const paises: Fatia[] = (pais as (string | number)[][]).map((r) => ({
    rotulo: PAIS[String(r[0])] ?? String(r[0]),
    views: Number(r[1] ?? 0),
  }));

  const dispositivos: Fatia[] = (disp as (string | number)[][]).map((r) => ({
    rotulo: DISPOSITIVO[String(r[0])] ?? String(r[0]),
    views: Number(r[1] ?? 0),
  }));

  const inscritos: Fatia[] = (insc as (string | number)[][]).map((r) => ({
    rotulo: String(r[0]) === "SUBSCRIBED" ? "Já era inscrito" : "Não inscrito",
    views: Number(r[1] ?? 0),
    minutos: Number(r[2] ?? 0),
  }));

  return {
    channelId, marca, janela, resumo, serie, formatos, topVideos,
    trafego, buscas, demografia, paises, dispositivos, inscritos,
  };
}

// ================= LEITURA ENXUTA (metas e visão geral) =================== //

export interface AnalyticsCanal {
  channelId: string;
  marca: string;
  ganhos: number;
  perdidos: number;
  liquido: number;
  views: number;
  minutosAssistidos: number;
  retencao: number | null;
  receita: number | null;
}

/**
 * Resumo de todos os canais configurados na competência — barato (2 consultas
 * por canal), para as metas e para a visão comparativa.
 *
 * Marcas sem `youtube` no config (Unicive, Everton) ficam de fora. Canal cuja
 * consulta falhe também sai, em vez de aparecer zerado: zero e "não consegui
 * ler" significam coisas opostas.
 */
export async function analyticsPorCompetencia(
  competencia: string,
): Promise<AnalyticsCanal[]> {
  // Mesmo motivo do `detalheDoCanal`: alimenta as metas, que são recarregadas a
  // cada troca de competência. Lista vazia não é cacheada — é o estado de
  // "desconectado", e prendê-lo por 30 min esconderia a reconexão.
  return cachedSwr(
    `yt-analytics-comp:${competencia}`,
    30 * 60_000,
    () => analyticsPorCompetenciaAoVivo(competencia),
    { cacheIf: (d) => d.length > 0 },
  );
}

async function analyticsPorCompetenciaAoVivo(
  competencia: string,
): Promise<AnalyticsCanal[]> {
  const token = await tokenDaConta();
  if (!token) return [];
  const janela = janelaCompetencia(competencia);

  const canais = MARKETING_AD_ACCOUNTS.filter((b) => b.youtube);
  const res = await Promise.all(
    canais.map(async (b) => {
      const id = b.youtube as string;
      const [base, rec] = await Promise.all([
        consulta(token, id, janela, {
          metrics:
            "subscribersGained,subscribersLost,views,estimatedMinutesWatched,averageViewPercentage",
        }),
        consulta(token, id, janela, { metrics: "estimatedRevenue", currency: "BRL" }),
      ]);
      const r = base[0] as number[] | undefined;
      if (!r) return null;
      const [ganhos = 0, perdidos = 0, views = 0, minutos = 0, retencao = 0] = r;
      return {
        channelId: id,
        marca: b.label,
        ganhos, perdidos, liquido: ganhos - perdidos,
        views, minutosAssistidos: minutos,
        retencao: retencao || null,
        receita: (rec[0] as number[] | undefined)?.[0] ?? null,
      } satisfies AnalyticsCanal;
    }),
  );
  return res.filter((r): r is AnalyticsCanal => r !== null);
}

/**
 * Ganho LÍQUIDO de inscritos por canal — a base da meta de seguidores do
 * YouTube, que ficou de fora enquanto só havia o dado público arredondado.
 *
 * Líquido (e não só `ganhos`) pela mesma razão do Instagram: é o que muda o
 * tamanho do canal. Perder 767 e ganhar 382 não é crescimento.
 */
export async function ganhoInscritosPorCanal(
  competencia: string,
): Promise<Map<string, number>> {
  const dados = await analyticsPorCompetencia(competencia);
  return new Map(dados.map((d) => [d.channelId, d.liquido]));
}
