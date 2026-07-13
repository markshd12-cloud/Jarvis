/**
 * Leitura das métricas de Marketing (Meta Ads) para o DASHBOARD.
 *
 * Fino adaptador sobre `metrics.ts` (fonte de verdade): resolve os filtros de
 * período/marca que a UI passa por searchParams e converte no shape
 * `MarketingDashboard` que o componente consome. A agregação e as datas (fuso
 * SP) vivem em `metrics.ts`.
 */
import {
  daysAgo,
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

export interface MarketingDashboard {
  hasData: boolean;
  /** Preset resolvido (para destacar o chip ativo). */
  range: RangeKey;
  since: string;
  until: string;
  /** Marca selecionada (`null` = todas). */
  brand: string | null;
  total: BrandMetrics;
  brands: BrandMetrics[];
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

/**
 * Métricas do Meta Ads no período/marca pedidos (por marca + total), no formato
 * do Dashboard. GLOBAL: sem company_id; o gate é feito na página.
 */
export async function getMarketingDashboard(
  q: MarketingQuery = {},
): Promise<MarketingDashboard> {
  const { range, since, until } = resolveRange(q);
  const brand = q.brand?.trim() || null;
  const m = await getMetaMetrics({ since, until, brand: brand ?? undefined });
  return {
    hasData: m.hasData,
    range,
    since,
    until,
    brand,
    total: m.total,
    brands: m.brands,
  };
}
