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

import { createSign } from "node:crypto";

import { GA4_PROPERTY_ID } from "@/lib/marketing/config";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const API = `https://analyticsdata.googleapis.com/v1beta/properties/${GA4_PROPERTY_ID}:runReport`;

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
  atualizadoEm: string;
}

const empty = (): Ga4Overview => ({
  hasData: false,
  totals: { sessions: 0, users: 0, newUsers: 0, pageviews: 0, conversions: 0, engajamento: 0, duracaoMediaSeg: 0 },
  byChannel: [],
  bySite: [],
  series: [],
  topPages: [],
  atualizadoEm: new Date().toISOString(),
});

function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}
const b64url = (s: string) => Buffer.from(s).toString("base64url");

// ------------------------------- auth -------------------------------------- //

let tokenCache: { token: string; exp: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.exp - 60_000) return tokenCache.token;

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON ausente");
  const sa = JSON.parse(raw) as { client_email: string; private_key: string };

  const now = Math.floor(Date.now() / 1000);
  const signingInput =
    `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.` +
    b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const signature = createSign("RSA-SHA256").update(signingInput).sign(sa.private_key).toString("base64url");
  const assertion = `${signingInput}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GA4 auth HTTP ${res.status}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: json.access_token, exp: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

// ------------------------------ Data API ----------------------------------- //

interface RunReportResp {
  rows?: {
    dimensionValues?: { value: string }[];
    metricValues?: { value: string }[];
  }[];
}

async function runReport(body: unknown): Promise<RunReportResp> {
  const token = await getAccessToken();
  const res = await fetch(API, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GA4 runReport HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as RunReportResp;
}

const RANGE_28D = [{ startDate: "27daysAgo", endDate: "today" }];

async function computeGa4(): Promise<Ga4Overview> {
  const [tot, chan, site, serie, pages] = await Promise.all([
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

  return {
    hasData: totals.sessions > 0 || byChannel.length > 0,
    totals,
    byChannel,
    bySite,
    series,
    topPages,
    atualizadoEm: new Date().toISOString(),
  };
}

// ------------------------------- cache ------------------------------------- //

const TTL = 10 * 60_000;
let cache: { at: number; data: Ga4Overview } | null = null;

/** Visão do GA4 (28 dias). Cache 10 min; degrada gracioso em falha. */
export async function getGa4Overview(): Promise<Ga4Overview> {
  if (cache && Date.now() - cache.at < TTL) return cache.data;
  try {
    const data = await computeGa4();
    if (data.hasData) cache = { at: Date.now(), data };
    return data;
  } catch (error) {
    console.error("[ga4] falha ao ler GA4:", (error as Error).message);
    return empty();
  }
}
