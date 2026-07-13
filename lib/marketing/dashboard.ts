/**
 * Leitura das métricas de Marketing (Meta Ads) para o DASHBOARD.
 *
 * Fino adaptador sobre `metrics.ts` (fonte de verdade): resolve os filtros de
 * período/marca que a UI passa por searchParams e monta o shape que o painel
 * consome — incluindo a SÉRIE diária (gráfico de tendência) e o período
 * ANTERIOR de igual duração (deltas). A agregação e as datas (fuso SP) vivem em
 * `metrics.ts`.
 */
import {
  daysAgo,
  getMetaDaily,
  getMetaMetrics,
  startOfMonth,
  today,
  type BrandMetrics,
} from "@/lib/marketing/metrics";

export type { BrandMetrics } from "@/lib/marketing/metrics";

/** Presets de período do filtro. `custom` usa `since`/`until` explícitos. */
export type RangeKey = "7" | "30" | "90" | "mes" | "custom";

const RANGE_KEYS: readonly RangeKey[] = ["7", "30", "90", "mes", "custom"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Filtros vindos da URL (todos opcionais; server component faz o parse). */
export interface MarketingQuery {
  range?: string;
  since?: string;
  until?: string;
  brand?: string;
}

/** Um ponto da série diária (total do período, já filtrado por marca). */
export interface DailyPoint {
  date: string;
  spend: number;
  clicks: number;
}

export interface MarketingDashboard {
  hasData: boolean;
  /** Preset resolvido (para destacar o chip ativo). */
  range: RangeKey;
  since: string;
  until: string;
  /** Marca selecionada (`null` = todas). */
  brand: string | null;
  total: BrandMetrics;
  /** Mesmas métricas no período imediatamente anterior (para os deltas). */
  previous: BrandMetrics;
  brands: BrandMetrics[];
  /** Série diária do período (crescente) para o gráfico de tendência. */
  series: DailyPoint[];
}

/** ISO (AAAA-MM-DD) deslocado por `delta` dias. Meio-dia evita borda de fuso. */
function shiftIso(iso: string, delta: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Dias entre duas datas ISO, inclusivo nas pontas. */
function inclusiveDays(a: string, b: string): number {
  const ms =
    new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

/** Resolve o preset + datas custom em um intervalo `[since, until]` (fuso SP). */
function resolveRange(q: MarketingQuery): {
  range: RangeKey;
  since: string;
  until: string;
} {
  const t = today();
  const range: RangeKey = RANGE_KEYS.includes(q.range as RangeKey)
    ? (q.range as RangeKey)
    : "30";

  if (range === "custom") {
    const s = q.since && ISO_DATE.test(q.since) ? q.since : daysAgo(29);
    const uRaw = q.until && ISO_DATE.test(q.until) ? q.until : t;
    const until = uRaw > t ? t : uRaw; // não passa de hoje
    const since = s <= until ? s : until; // garante ordem cronológica
    return { range, since, until };
  }
  if (range === "mes") return { range, since: startOfMonth(), until: t };
  const days = range === "7" ? 7 : range === "90" ? 90 : 30;
  return { range, since: daysAgo(days - 1), until: t };
}

/** Colapsa as linhas diárias por-marca em um total por dia (crescente). */
function toSeries(
  rows: { date: string; spend: number; clicks: number }[],
): DailyPoint[] {
  const byDate = new Map<string, DailyPoint>();
  for (const r of rows) {
    const p = byDate.get(r.date) ?? { date: r.date, spend: 0, clicks: 0 };
    p.spend += r.spend;
    p.clicks += r.clicks;
    byDate.set(r.date, p);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Métricas do Meta Ads no período/marca pedidos, com série diária e período
 * anterior para os deltas. GLOBAL: sem company_id; o gate é feito na página.
 */
export async function getMarketingDashboard(
  q: MarketingQuery = {},
): Promise<MarketingDashboard> {
  const { range, since, until } = resolveRange(q);
  const brand = q.brand?.trim() || null;
  const brandArg = brand ?? undefined;

  // Período anterior de igual duração, imediatamente antes de `since`.
  const len = inclusiveDays(since, until);
  const prevUntil = shiftIso(since, -1);
  const prevSince = shiftIso(prevUntil, -(len - 1));

  const [m, prev, daily] = await Promise.all([
    getMetaMetrics({ since, until, brand: brandArg }),
    getMetaMetrics({ since: prevSince, until: prevUntil, brand: brandArg }),
    getMetaDaily({ since, until }),
  ]);

  const series = toSeries(
    (brand ? daily.filter((r) => r.brand === brand) : daily).map((r) => ({
      date: r.date,
      spend: r.spend,
      clicks: r.clicks,
    })),
  );

  return {
    hasData: m.hasData,
    range,
    since,
    until,
    brand,
    total: m.total,
    previous: prev.total,
    brands: m.brands,
    series,
  };
}
