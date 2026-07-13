/**
 * Fonte de verdade única das métricas do Meta Ads (leitura).
 *
 * Consultado tanto pelo Dashboard (`dashboard.ts`) quanto pelo chat do Jarvis
 * (`ai/marketing-context.ts`). Lê `marketing_daily_insights` via service_role
 * (a tabela tem RLS sem policies) e agrega por intervalo de datas.
 *
 * Datas no fuso America/Sao_Paulo: a Insights API da Meta reporta `date_start`
 * no fuso da conta de anúncio (SP), então "hoje"/"mês" precisam ser calculados
 * no mesmo fuso — senão perto da meia-noite o dia/mês sai trocado.
 *
 * GLOBAL: sem company_id. O chamador faz o gate por `can(ctx, "marketing")`.
 */
import { createAdminClient } from "@/lib/supabase/admin";

const TZ = "America/Sao_Paulo";
// en-CA formata como AAAA-MM-DD, igual à coluna `date`.
const ymdFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Data de hoje (AAAA-MM-DD) no fuso de São Paulo. */
export function today(): string {
  return ymdFmt.format(new Date());
}

/** Primeiro dia do mês corrente (SP). */
export function startOfMonth(): string {
  return `${today().slice(0, 7)}-01`;
}

/** Data de `n` dias atrás relativa a hoje (SP). Meio-dia evita borda de fuso. */
export function daysAgo(n: number): string {
  const d = new Date(`${today()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export interface BrandMetrics {
  /** Rótulo da marca; `null` = agregado geral (soma de todas). */
  brand: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  /** Conversões (Fase 1). */
  leads: number;
  conversations: number;
  purchases: number;
  conversionValue: number;
  /** Derivadas das somas; `null` quando o denominador é zero. */
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  /** Custo por lead (`spend/leads`) e por conversa (`spend/conversations`). */
  cpl: number | null;
  costPerConversation: number | null;
  /** Retorno sobre investimento (`conversionValue/spend`); null sem gasto. */
  roas: number | null;
}

export interface MetaMetrics {
  since: string;
  until: string;
  hasData: boolean;
  total: BrandMetrics;
  brands: BrandMetrics[];
}

export interface MetaDailyRow {
  date: string;
  brand: string;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
}

/** Linha crua da tabela (campos numéricos podem vir nulos). */
interface Row {
  date?: string;
  brand: string;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  reach: number | null;
  leads?: number | null;
  conversations?: number | null;
  purchases?: number | null;
  conversion_value?: number | null;
}

interface Acc {
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  leads: number;
  conversations: number;
  purchases: number;
  conversionValue: number;
}

const emptyAcc = (): Acc => ({
  spend: 0,
  impressions: 0,
  clicks: 0,
  reach: 0,
  leads: 0,
  conversations: 0,
  purchases: 0,
  conversionValue: 0,
});

function add(a: Acc, r: Row): void {
  a.spend += r.spend ?? 0;
  a.impressions += r.impressions ?? 0;
  a.clicks += r.clicks ?? 0;
  a.reach += r.reach ?? 0;
  a.leads += r.leads ?? 0;
  a.conversations += r.conversations ?? 0;
  a.purchases += r.purchases ?? 0;
  a.conversionValue += r.conversion_value ?? 0;
}

function finalize(brand: string | null, a: Acc): BrandMetrics {
  return {
    brand,
    spend: a.spend,
    impressions: a.impressions,
    clicks: a.clicks,
    reach: a.reach,
    leads: a.leads,
    conversations: a.conversations,
    purchases: a.purchases,
    conversionValue: a.conversionValue,
    ctr: a.impressions ? (a.clicks / a.impressions) * 100 : null,
    cpc: a.clicks ? a.spend / a.clicks : null,
    cpm: a.impressions ? (a.spend / a.impressions) * 1000 : null,
    cpl: a.leads ? a.spend / a.leads : null,
    costPerConversation: a.conversations ? a.spend / a.conversations : null,
    roas: a.spend ? a.conversionValue / a.spend : null,
  };
}

/**
 * Agrega o Meta Ads no intervalo `[since, until]` (datas SP, inclusivas), por
 * marca e no total, opcionalmente filtrando por uma marca. Usa só as linhas
 * por-marca (brand ≠ null); o total é a soma delas. Marcas ordenadas por gasto.
 */
export async function getMetaMetrics(opts: {
  since: string;
  until: string;
  brand?: string;
}): Promise<MetaMetrics> {
  const { since, until, brand } = opts;
  const admin = createAdminClient();
  let query = admin
    .from("marketing_daily_insights")
    .select(
      "brand, spend, impressions, clicks, reach, leads, conversations, purchases, conversion_value",
    )
    .eq("provider", "meta_ads")
    .not("brand", "is", null)
    .gte("date", since)
    .lte("date", until);
  if (brand) query = query.eq("brand", brand);
  const { data, error } = await query;

  const empty: MetaMetrics = {
    since,
    until,
    hasData: false,
    total: finalize(null, emptyAcc()),
    brands: [],
  };
  if (error || !data || data.length === 0) return empty;

  const byBrand = new Map<string, Acc>();
  const total = emptyAcc();
  for (const r of data as Row[]) {
    const acc = byBrand.get(r.brand) ?? emptyAcc();
    add(acc, r);
    byBrand.set(r.brand, acc);
    add(total, r);
  }

  return {
    since,
    until,
    hasData: true,
    total: finalize(null, total),
    brands: [...byBrand]
      .map(([b, a]) => finalize(b, a))
      .sort((x, y) => y.spend - x.spend),
  };
}

/**
 * Linhas DIÁRIAS por marca no intervalo `[since, until]` (ordenadas por data
 * crescente). Alimenta a tabela diária injetada no chat e o gráfico futuro.
 */
export async function getMetaDaily(opts: {
  since: string;
  until: string;
}): Promise<MetaDailyRow[]> {
  const { since, until } = opts;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("marketing_daily_insights")
    .select("date, brand, spend, impressions, clicks, reach")
    .eq("provider", "meta_ads")
    .not("brand", "is", null)
    .gte("date", since)
    .lte("date", until)
    .order("date", { ascending: true });
  if (error || !data) return [];
  return (data as Row[]).map((r) => ({
    date: r.date as string,
    brand: r.brand,
    spend: r.spend ?? 0,
    impressions: r.impressions ?? 0,
    clicks: r.clicks ?? 0,
    reach: r.reach ?? 0,
  }));
}
