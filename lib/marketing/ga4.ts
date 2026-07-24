/**
 * GA4 (Google Analytics 4) — leitura do site via Data API v1 (`:runReport`).
 *
 * Auth REUSA a service account do Vertex (`GOOGLE_SERVICE_ACCOUNT_JSON`), que tem
 * acesso de Leitor na propriedade (ver `config.GA4_PROPERTY_ID`). O access token é
 * obtido por JWT assinado com `node:crypto` (RS256) — sem lib extra. GLOBAL (sem
 * company_id): o gate é `can(ctx, "ga4")` na página. Server-only.
 *
 * Lê AO VIVO (como o Conta Azul), com cache de 10 min — GA4 é rápido (poucas
 * chamadas) e não precisa de tabela/sync próprio. Degrada gracioso: erro/sem
 * credencial → `hasData:false` (o dashboard some a seção sem quebrar).
 */
import "server-only";

import { cachedSwr } from "@/lib/cache/kv";
import { getGoogleAccessToken } from "@/lib/google/auth";
import { GA4_PROPERTY_ID } from "@/lib/marketing/config";

const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const API_BASE = `https://analyticsdata.googleapis.com/v1beta/properties/${GA4_PROPERTY_ID}`;
const API = `${API_BASE}:runReport`;
const API_REALTIME = `${API_BASE}:runRealtimeReport`;

// ------------------------------- tipos ------------------------------------- //

export interface Ga4ChannelRow {
  channel: string;
  sessions: number;
}
export interface Ga4Point {
  date: string; // 'AAAA-MM-DD'
  sessions: number;
  users: number;
}
export interface Ga4Page {
  /** host + path (ex.: "colegio.cppem.com.br/matriculas") — desambigua multi-site. */
  path: string;
  views: number;
}
/** Sessões por SITE (hostName) — essencial com vários domínios numa propriedade. */
export interface Ga4Site {
  site: string;
  sessions: number;
  users: number;
}
/** Atribuição fina: origem/mídia da sessão (ex.: "google / cpc"). */
export interface Ga4SourceRow {
  sourceMedium: string;
  sessions: number;
  users: number;
  /** true p/ "(not set)"/"(data not available)" — tráfego SEM atribuição (UTM faltando). */
  semAtribuicao: boolean;
}
export interface Ga4CampaignRow {
  campaign: string;
  sessions: number;
}
/** Página de ENTRADA (host + landingPage) — onde a sessão começou. */
export interface Ga4Landing {
  path: string;
  sessions: number;
}
/** Segmento genérico (dispositivo, cidade, novo/recorrente). */
export interface Ga4Segment {
  label: string;
  sessions: number;
}
/** Sessões por hora do dia (0-23), no fuso da propriedade. */
export interface Ga4Hour {
  hour: number;
  sessions: number;
}
/** Qualidade do tráfego. */
export interface Ga4Behavior {
  bounceRate: number; // 0-100
  engagedSessions: number;
  pagesPerSession: number;
  sessionsPerUser: number;
}
/** Tempo real: quem está no site AGORA (Fase 3). */
export interface Ga4RealtimePage {
  page: string;
  users: number;
}
export interface Ga4Realtime {
  activeUsers: number;
  byPage: Ga4RealtimePage[];
  atualizadoEm: string;
}
export interface Ga4Overview {
  hasData: boolean;
  totals: {
    sessions: number;
    users: number;
    newUsers: number;
    pageviews: number;
    conversions: number;
    engajamento: number; // taxa de engajamento (0-100)
    duracaoMediaSeg: number; // duração média da sessão (s)
  };
  byChannel: Ga4ChannelRow[];
  bySite: Ga4Site[];
  series: Ga4Point[];
  topPages: Ga4Page[];
  // ---- Fase 1: atribuição + páginas de entrada ----
  bySourceMedium: Ga4SourceRow[];
  byCampaign: Ga4CampaignRow[];
  landingPages: Ga4Landing[];
  /** Sessões sem atribuição; alto = UTMs faltando (ver docs/ga4-tracking-setup.md). */
  semAtribuicaoSessions: number;
  /** Total de sessões do relatório de origem (base p/ o % sem atribuição). */
  atribuicaoTotalSessions: number;
  // ---- Fase 2: dispositivo, geo, comportamento ----
  byDevice: Ga4Segment[];
  byNewReturning: Ga4Segment[];
  byCity: Ga4Segment[];
  byHour: Ga4Hour[];
  behavior: Ga4Behavior;
  atualizadoEm: string;
}

const empty = (): Ga4Overview => ({
  hasData: false,
  totals: { sessions: 0, users: 0, newUsers: 0, pageviews: 0, conversions: 0, engajamento: 0, duracaoMediaSeg: 0 },
  byChannel: [],
  bySite: [],
  series: [],
  topPages: [],
  bySourceMedium: [],
  byCampaign: [],
  landingPages: [],
  semAtribuicaoSessions: 0,
  atribuicaoTotalSessions: 0,
  byDevice: [],
  byNewReturning: [],
  byCity: [],
  byHour: [],
  behavior: { bounceRate: 0, engagedSessions: 0, pagesPerSession: 0, sessionsPerUser: 0 },
  atualizadoEm: new Date().toISOString(),
});

/** Rótulos pt-BR das dimensões do GA4. */
const DEVICE_LABEL: Record<string, string> = {
  mobile: "Celular",
  desktop: "Computador",
  tablet: "Tablet",
};
const NVR_LABEL: Record<string, string> = {
  new: "Novos",
  returning: "Recorrentes",
};
const NAO_IDENTIFICADO = "(não identificado)";
const rotulo = (map: Record<string, string>, v: string) =>
  map[v] ?? (isSemAtribuicao(v) ? NAO_IDENTIFICADO : v);

function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

/** Valores que o GA4 usa quando NÃO conseguiu atribuir a origem (UTM faltando). */
const SEM_ATRIBUICAO = new Set(["(not set)", "(data not available)", "(none)", ""]);
const isSemAtribuicao = (s: string) => SEM_ATRIBUICAO.has(s.trim());

// ------------------------------- auth -------------------------------------- //

const getAccessToken = () => getGoogleAccessToken(SCOPE);

// ------------------------------ Data API ----------------------------------- //

interface RunReportResp {
  rows?: {
    dimensionValues?: { value: string }[];
    metricValues?: { value: string }[];
  }[];
}

async function post(url: string, body: unknown): Promise<RunReportResp> {
  const token = await getAccessToken();
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GA4 HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as RunReportResp;
}

const runReport = (body: unknown) => post(API, body);
/** Realtime tem um conjunto de dimensões PRÓPRIO (ex.: `hostName` é inválido lá). */
const runRealtime = (body: unknown) => post(API_REALTIME, body);

/**
 * Agrega linhas por chave somando as métricas. O GA4 pode devolver a MESMA chave
 * em linhas separadas — sem isso vira duplicata (e key duplicada no React).
 */
function aggregate(
  rows: RunReportResp["rows"],
  keyOf: (dims: string[]) => string,
  metricCount = 1,
): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const r of rows ?? []) {
    const dims = (r.dimensionValues ?? []).map((d) => d.value);
    const k = keyOf(dims);
    const cur = out.get(k) ?? new Array<number>(metricCount).fill(0);
    for (let i = 0; i < metricCount; i++) cur[i] += n(r.metricValues?.[i]?.value);
    out.set(k, cur);
  }
  return out;
}

const RANGE_28D = [{ startDate: "27daysAgo", endDate: "today" }];

async function computeGa4(): Promise<Ga4Overview> {
  const [tot, chan, site, serie, pages, srcMed, camp, landing, devNvr, cidade, hora, comport] =
    await Promise.all([
    runReport({
      dateRanges: RANGE_28D,
      metrics: [
        { name: "sessions" }, { name: "totalUsers" }, { name: "newUsers" },
        { name: "screenPageViews" }, { name: "conversions" },
        { name: "engagementRate" }, { name: "averageSessionDuration" },
      ],
    }),
    runReport({
      dateRanges: RANGE_28D,
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "sessions" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 8,
    }),
    // Por SITE (hostName) — desambigua os vários domínios do CPPEM.
    runReport({
      dateRanges: RANGE_28D,
      dimensions: [{ name: "hostName" }],
      metrics: [{ name: "sessions" }, { name: "totalUsers" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 10,
    }),
    runReport({
      dateRanges: RANGE_28D,
      dimensions: [{ name: "date" }],
      metrics: [{ name: "sessions" }, { name: "totalUsers" }],
      orderBys: [{ dimension: { dimensionName: "date" } }],
      limit: 40,
    }),
    // Top páginas COM host → "colegio.cppem.com.br/matriculas" em vez de só "/".
    runReport({
      dateRanges: RANGE_28D,
      dimensions: [{ name: "hostName" }, { name: "pagePath" }],
      metrics: [{ name: "screenPageViews" }],
      orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      limit: 8,
    }),
    // Fase 1 — atribuição fina: de onde veio a sessão (origem/mídia).
    runReport({
      dateRanges: RANGE_28D,
      dimensions: [{ name: "sessionSourceMedium" }],
      metrics: [{ name: "sessions" }, { name: "totalUsers" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 12,
    }),
    // Fase 1 — campanhas (UTM). "(not set)" alto = UTM faltando.
    runReport({
      dateRanges: RANGE_28D,
      dimensions: [{ name: "sessionCampaignName" }],
      metrics: [{ name: "sessions" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 8,
    }),
    // Fase 1 — páginas de ENTRADA (com host, p/ desambiguar multi-site).
    runReport({
      dateRanges: RANGE_28D,
      dimensions: [{ name: "hostName" }, { name: "landingPage" }],
      metrics: [{ name: "sessions" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 8,
    }),
    // Fase 2 — dispositivo × novo/recorrente: 1 request, DOIS eixos (agregamos
    // cada dimensão separadamente depois). Economiza uma chamada.
    runReport({
      dateRanges: RANGE_28D,
      dimensions: [{ name: "deviceCategory" }, { name: "newVsReturning" }],
      metrics: [{ name: "sessions" }],
      limit: 20,
    }),
    // Fase 2 — geo (cidade).
    runReport({
      dateRanges: RANGE_28D,
      dimensions: [{ name: "city" }],
      metrics: [{ name: "sessions" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 8,
    }),
    // Fase 2 — sessões por hora do dia (quando o site bomba).
    runReport({
      dateRanges: RANGE_28D,
      dimensions: [{ name: "hour" }],
      metrics: [{ name: "sessions" }],
      limit: 24,
    }),
    // Fase 2 — qualidade do tráfego (limite de 10 métricas/request → relatório à parte).
    runReport({
      dateRanges: RANGE_28D,
      metrics: [
        { name: "bounceRate" }, { name: "engagedSessions" },
        { name: "screenPageViewsPerSession" }, { name: "sessionsPerUser" },
      ],
    }),
  ]);

  const t = tot.rows?.[0]?.metricValues ?? [];
  const totals = {
    sessions: n(t[0]?.value),
    users: n(t[1]?.value),
    newUsers: n(t[2]?.value),
    pageviews: n(t[3]?.value),
    conversions: n(t[4]?.value),
    engajamento: n(t[5]?.value) * 100,
    duracaoMediaSeg: n(t[6]?.value),
  };

  const chanMap = new Map<string, number>();
  for (const r of chan.rows ?? []) {
    const c = r.dimensionValues?.[0]?.value ?? "—";
    chanMap.set(c, (chanMap.get(c) ?? 0) + n(r.metricValues?.[0]?.value));
  }
  const byChannel: Ga4ChannelRow[] = [...chanMap.entries()]
    .map(([channel, sessions]) => ({ channel, sessions }))
    .sort((a, b) => b.sessions - a.sessions);

  // Agrega por site: o GA4 pode devolver o MESMO host em linhas separadas —
  // somamos p/ ter 1 linha por domínio (e chave única na UI).
  const siteMap = new Map<string, Ga4Site>();
  for (const r of site.rows ?? []) {
    const s = r.dimensionValues?.[0]?.value ?? "—";
    const cur = siteMap.get(s) ?? { site: s, sessions: 0, users: 0 };
    cur.sessions += n(r.metricValues?.[0]?.value);
    cur.users += n(r.metricValues?.[1]?.value);
    siteMap.set(s, cur);
  }
  const bySite: Ga4Site[] = [...siteMap.values()].sort((a, b) => b.sessions - a.sessions);

  const series: Ga4Point[] = (serie.rows ?? [])
    .map((r) => {
      const d = r.dimensionValues?.[0]?.value ?? ""; // 'AAAAMMDD'
      const date = d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d;
      return { date, sessions: n(r.metricValues?.[0]?.value), users: n(r.metricValues?.[1]?.value) };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  // Idem para páginas: agrega por "host+path" (dedupe + chave única).
  const pageMap = new Map<string, number>();
  for (const r of pages.rows ?? []) {
    const key = `${r.dimensionValues?.[0]?.value ?? ""}${r.dimensionValues?.[1]?.value ?? ""}`;
    pageMap.set(key, (pageMap.get(key) ?? 0) + n(r.metricValues?.[0]?.value));
  }
  const topPages: Ga4Page[] = [...pageMap.entries()]
    .map(([path, views]) => ({ path, views }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 8);

  // ---- Fase 1: atribuição + páginas de entrada ----
  const bySourceMedium: Ga4SourceRow[] = [...aggregate(srcMed.rows, (d) => d[0] ?? "—", 2)]
    .map(([sourceMedium, [sessions, users]]) => ({
      sourceMedium,
      sessions,
      users,
      // "(direct) / (none)" é direto (legítimo), não falta de UTM: só marcamos
      // como sem atribuição o que o GA4 não soube classificar.
      semAtribuicao: sourceMedium.split("/").every((p) => isSemAtribuicao(p)),
    }))
    .sort((a, b) => b.sessions - a.sessions);

  const byCampaign: Ga4CampaignRow[] = [...aggregate(camp.rows, (d) => d[0] ?? "—")]
    .map(([campaign, [sessions]]) => ({ campaign, sessions }))
    .sort((a, b) => b.sessions - a.sessions);

  // Rótulo legível: host+path quando há path; buckets vazio/"(not set)" ficam
  // explícitos (NÃO são fundidos com "/" — seriam números diferentes).
  const landingKey = (d: string[]): string => {
    const host = d[0] ?? "";
    const lp = (d[1] ?? "").trim();
    if (lp === "") return `${host} · (vazia)`;
    if (lp === "(not set)") return `${host} · (não identificada)`;
    return `${host}${lp}`;
  };
  const landingPages: Ga4Landing[] = [...aggregate(landing.rows, landingKey)]
    .map(([path, [sessions]]) => ({ path, sessions }))
    .sort((a, b) => b.sessions - a.sessions);

  const atribuicaoTotalSessions = bySourceMedium.reduce((s, r) => s + r.sessions, 0);
  const semAtribuicaoSessions = bySourceMedium
    .filter((r) => r.semAtribuicao)
    .reduce((s, r) => s + r.sessions, 0);

  // ---- Fase 2: dispositivo, novo/recorrente, geo, hora, comportamento ----
  const porSessoes = (m: Map<string, number[]>): Ga4Segment[] =>
    [...m]
      .map(([label, [sessions]]) => ({ label, sessions }))
      .filter((s) => s.sessions > 0)
      .sort((a, b) => b.sessions - a.sessions);

  // O MESMO relatório alimenta os dois eixos (somando sobre a outra dimensão).
  const byDevice = porSessoes(aggregate(devNvr.rows, (d) => rotulo(DEVICE_LABEL, d[0] ?? "")));
  const byNewReturning = porSessoes(aggregate(devNvr.rows, (d) => rotulo(NVR_LABEL, d[1] ?? "")));
  const byCity = porSessoes(
    aggregate(cidade.rows, (d) => (isSemAtribuicao(d[0] ?? "") ? NAO_IDENTIFICADO : (d[0] ?? ""))),
  );
  const byHour: Ga4Hour[] = [...aggregate(hora.rows, (d) => d[0] ?? "")]
    .map(([h, [sessions]]) => ({ hour: Number(h), sessions }))
    .filter((h) => Number.isFinite(h.hour))
    .sort((a, b) => a.hour - b.hour);

  const b = comport.rows?.[0]?.metricValues ?? [];
  const behavior: Ga4Behavior = {
    bounceRate: n(b[0]?.value) * 100, // vem como razão (0-1)
    engagedSessions: n(b[1]?.value),
    pagesPerSession: n(b[2]?.value),
    sessionsPerUser: n(b[3]?.value),
  };

  return {
    hasData: totals.sessions > 0 || byChannel.length > 0,
    totals,
    byChannel,
    bySite,
    series,
    topPages,
    bySourceMedium,
    byCampaign,
    landingPages,
    semAtribuicaoSessions,
    atribuicaoTotalSessions,
    byDevice,
    byNewReturning,
    byCity,
    byHour,
    behavior,
    atualizadoEm: new Date().toISOString(),
  };
}

// ------------------------------- cache ------------------------------------- //

// SWR de 2 camadas (memória + Supabase `cache_kv`): sobrevive a redeploy e é
// compartilhado entre réplicas. São 8 runReports por load frio — com cache, isso
// roda no máximo 1× a cada 10 min globalmente. Ver `lib/cache/kv.ts`.
const TTL = 10 * 60_000;

/** Visão do GA4 (28 dias). Cache SWR 10 min; degrada gracioso em falha. */
export async function getGa4Overview(): Promise<Ga4Overview> {
  const compute = async (): Promise<Ga4Overview> => {
    try {
      return await computeGa4();
    } catch (error) {
      console.error("[ga4] falha ao ler GA4:", (error as Error).message);
      return empty();
    }
  };
  return cachedSwr("ga4:overview:28d", TTL, compute, { cacheIf: (d) => d.hasData });
}

// --------------------------- Fase 3 — tempo real ---------------------------- //

// TTL curto: "tempo real" com 10 min de cache não seria tempo real. 60s equilibra
// frescor e volume de chamadas (a página é server-rendered a cada request).
const TTL_REALTIME = 60_000;

/**
 * Usuários ativos AGORA + o que estão vendo. Zero usuários é resposta VÁLIDA (a
 * API devolve 0 linhas quando não há ninguém) — não é erro. Cache SWR 60s.
 */
export async function getGa4Realtime(): Promise<Ga4Realtime> {
  const compute = async (): Promise<Ga4Realtime> => {
    try {
      const [tot, porPagina] = await Promise.all([
        runRealtime({ metrics: [{ name: "activeUsers" }] }),
        runRealtime({
          dimensions: [{ name: "unifiedScreenName" }],
          metrics: [{ name: "activeUsers" }],
          limit: 5,
        }),
      ]);
      return {
        activeUsers: n(tot.rows?.[0]?.metricValues?.[0]?.value),
        byPage: [...aggregate(porPagina.rows, (d) => d[0] ?? "—")]
          .map(([page, [users]]) => ({ page, users }))
          .sort((a, b) => b.users - a.users),
        atualizadoEm: new Date().toISOString(),
      };
    } catch (error) {
      console.error("[ga4] falha no realtime:", (error as Error).message);
      return { activeUsers: 0, byPage: [], atualizadoEm: new Date().toISOString() };
    }
  };
  // Sem `cacheIf`: 0 usuários é um resultado legítimo e deve ser cacheado.
  return cachedSwr("ga4:realtime", TTL_REALTIME, compute);
}
