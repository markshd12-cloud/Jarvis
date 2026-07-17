import Link from "next/link";

import { InteractiveDonutRing } from "@/components/charts/interactive-donut";
import { InteractiveLineChart } from "@/components/charts/interactive-line";
import { MarketingDateRange } from "@/components/marketing-date-range";
import type {
  BrandMetrics,
  MarketingDashboard,
  RangeKey,
} from "@/lib/marketing/dashboard";

/**
 * Painel de aproveitamento do Meta Ads. Server component (sem estado de
 * cliente): filtros de período/marca navegam por searchParams via
 * <Link>/<form method="get"> e o server re-consulta `getMarketingDashboard()`.
 * Gráficos (tendência + pizza) são SVG/CSS a partir de dados reais; o gate de
 * permissão é feito na página.
 */

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const brlCompact = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});
const int = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

const money = (v: number | null) => (v == null ? "—" : brl.format(v));
const count = (v: number | null) => (v == null ? "—" : int.format(v));
const pct = (v: number | null) =>
  v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
// ROAS é um multiplicador (retorno por R$1): 3,5 → "3,5×".
const mult = (v: number | null) =>
  v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×`;

const ddmmyyyy = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

/** Paleta de séries (verde da marca → tons de apoio) para o donut. */
const CHART_VARS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

const RANGE_LABELS: { key: RangeKey; label: string }[] = [
  { key: "7", label: "7 dias" },
  { key: "30", label: "30 dias" },
  { key: "mes", label: "Mês atual" },
];

interface Selection {
  range: RangeKey;
  since: string;
  until: string;
  brand: string | null;
}

/** Monta o href do Dashboard preservando os filtros, com os `overrides`. */
function buildHref(sel: Selection, overrides: Partial<Selection>): string {
  const m = { ...sel, ...overrides };
  const p = new URLSearchParams();
  if (m.range && m.range !== "30") p.set("range", m.range);
  if (m.range === "custom") {
    p.set("since", m.since);
    p.set("until", m.until);
  }
  if (m.brand) p.set("brand", m.brand);
  const qs = p.toString();
  return qs ? `/dashboard?${qs}` : "/dashboard";
}

function Chip({
  href,
  active,
  brand = false,
  children,
}: {
  href: string;
  active: boolean;
  brand?: boolean;
  children: React.ReactNode;
}) {
  const activeCls = brand
    ? "border-transparent bg-[var(--brand)] text-black"
    : "border-transparent bg-foreground text-background";
  return (
    <Link
      href={href}
      scroll={false}
      className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
        active
          ? activeCls
          : "border-border text-muted-foreground hover:bg-muted/60"
      }`}
    >
      {children}
    </Link>
  );
}

/** Variação vs. período anterior. `goodWhenDown` inverte a cor (CPC/CPM). */
function Delta({
  cur,
  prev,
  goodWhenDown = false,
}: {
  cur: number;
  prev: number;
  goodWhenDown?: boolean;
}) {
  if (!prev) {
    return (
      <span className="mt-1 text-xs font-medium text-muted-foreground">
        {cur ? "novo no período" : "—"}
      </span>
    );
  }
  const change = ((cur - prev) / prev) * 100;
  const rounded = Math.round(change);
  if (rounded === 0) {
    return (
      <span className="mt-1 text-xs font-medium text-muted-foreground">
        estável
      </span>
    );
  }
  const good = goodWhenDown ? change < 0 : change > 0;
  const arrow = change > 0 ? "▲" : "▼";
  return (
    <span
      className={`mt-1 inline-flex items-center gap-1 text-xs font-semibold ${
        good
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-red-600 dark:text-red-400"
      }`}
    >
      {arrow} {Math.abs(rounded)}%
    </span>
  );
}

function Kpi({
  label,
  value,
  cur,
  prev,
  goodWhenDown,
  highlight = false,
}: {
  label: string;
  value: string;
  cur: number;
  prev: number;
  goodWhenDown?: boolean;
  highlight?: boolean;
}) {
  return (
    <div
      className={`flex flex-col rounded-xl border border-border p-4 ${
        highlight ? "bg-[var(--brand)]/10" : "bg-card"
      }`}
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
        {value}
      </p>
      <Delta cur={cur} prev={prev} goodWhenDown={goodWhenDown} />
    </div>
  );
}

/** Donut (pizza) do investimento por marca — anel + legenda clicáveis (filtram
 *  o dashboard pela marca; clicar na marca ativa remove o filtro). */
function SpendDonut({
  brands,
  total,
  sel,
  brand,
}: {
  brands: BrandMetrics[];
  total: number;
  sel: Selection;
  brand: string | null;
}) {
  const legend = brands.map((b, i) => ({
    name: b.brand ?? "?",
    value: b.spend,
    color: CHART_VARS[i % CHART_VARS.length],
    pctv: total ? (b.spend / total) * 100 : 0,
  }));
  const top = legend[0];
  const hrefFor = (name: string) =>
    buildHref(sel, { brand: brand === name ? null : name });

  return (
    <div className="flex items-center gap-5">
      <InteractiveDonutRing
        items={legend.map((l) => ({
          label: l.name,
          value: l.value,
          color: l.color,
        }))}
        hrefs={legend.map((l) => hrefFor(l.name))}
      >
        <div>
          <p className="text-sm font-semibold tabular-nums leading-none">
            {top ? `${Math.round(top.pctv)}%` : "—"}
          </p>
          <p className="mt-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
            {top?.name.split(" ")[0] ?? ""}
          </p>
        </div>
      </InteractiveDonutRing>
      <ul className="flex flex-col gap-1 text-sm">
        {legend.map((l) => {
          const active = brand === l.name;
          return (
            <li key={l.name}>
              <Link
                href={hrefFor(l.name)}
                scroll={false}
                className={`-mx-1 flex items-center gap-2 rounded-md px-1 py-0.5 transition-colors hover:bg-muted/60 ${
                  active ? "bg-muted/50" : ""
                }`}
              >
                <span className="h-2.5 w-2.5 flex-none rounded-sm"
                  style={{ background: l.color }} />
                <span className={active ? "text-foreground" : "text-muted-foreground"}>
                  {l.name}
                </span>
                <span className="ml-auto tabular-nums font-medium">
                  {brlCompact.format(l.value)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function MarketingMetrics({
  data,
  allBrands,
}: {
  data: MarketingDashboard;
  allBrands: string[];
}) {
  const { total, previous, brands, range, since, until, brand, series } = data;
  const sel: Selection = { range, since, until, brand };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">
          Meta Ads · aproveitamento
        </h2>
        <p className="text-sm text-muted-foreground">
          {brand ? `${brand} · ` : "Todas as marcas · "}
          {ddmmyyyy(since)} a {ddmmyyyy(until)}
        </p>
      </div>

      {/* Filtro de período */}
      <div className="flex flex-wrap items-center gap-2">
        {RANGE_LABELS.map(({ key, label }) => (
          <Chip key={key} href={buildHref(sel, { range: key })} active={range === key}>
            {label}
          </Chip>
        ))}
        <MarketingDateRange
          key={`${since}-${until}`}
          since={since}
          until={until}
          isCustom={range === "custom"}
        />
      </div>

      {/* Filtro de marca */}
      <div className="flex flex-wrap items-center gap-2">
        <Chip href={buildHref(sel, { brand: null })} active={!brand}>
          Todas
        </Chip>
        {allBrands.map((b) => (
          <Chip key={b} href={buildHref(sel, { brand: b })} active={brand === b} brand>
            {b}
          </Chip>
        ))}
      </div>

      {!data.hasData ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
          Nenhum dado no período/marca selecionados. Ajuste o filtro ou rode a
          sincronização em Configurações → Conexões → Meta Ads.
        </div>
      ) : (
        <>
          {/* KPIs com deltas vs. período anterior */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi label="Investimento" value={money(total.spend)}
              cur={total.spend} prev={previous.spend} highlight />
            <Kpi label="ROAS (vendas)" value={mult(total.roas)}
              cur={total.roas ?? 0} prev={previous.roas ?? 0} highlight />
            <Kpi label="CAC (leads)" value={money(total.cac)}
              cur={total.cac ?? 0} prev={previous.cac ?? 0} goodWhenDown highlight />
            <Kpi label="Leads" value={count(total.leads)}
              cur={total.leads} prev={previous.leads} />
            <Kpi label="CPL" value={money(total.cpl)}
              cur={total.cpl ?? 0} prev={previous.cpl ?? 0} goodWhenDown />
            <Kpi label="Conversas WPP" value={count(total.conversations)}
              cur={total.conversations} prev={previous.conversations} />
            <Kpi label="Impressões" value={count(total.impressions)}
              cur={total.impressions} prev={previous.impressions} />
            <Kpi label="Cliques" value={count(total.clicks)}
              cur={total.clicks} prev={previous.clicks} />
            <Kpi label="Alcance" value={count(total.reach)}
              cur={total.reach} prev={previous.reach} />
            <Kpi label="CTR" value={pct(total.ctr)}
              cur={total.ctr ?? 0} prev={previous.ctr ?? 0} />
            <Kpi label="CPC" value={money(total.cpc)}
              cur={total.cpc ?? 0} prev={previous.cpc ?? 0} goodWhenDown />
          </div>

          {/* Tendência + Pizza */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.55fr_1fr]">
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex items-baseline gap-3">
                <h3 className="text-sm font-semibold tracking-tight">
                  Investimento por dia
                </h3>
              </div>
              <InteractiveLineChart
                points={series.map((p) => ({
                  label: ddmmyyyy(p.date),
                  values: { spend: p.spend, clicks: p.clicks },
                }))}
                series={[
                  { key: "spend", label: "Investimento", color: "var(--brand)", area: true, format: "brl" },
                  { key: "clicks", label: "Cliques", color: "var(--chart-3)", dashed: true, format: "int" },
                ]}
                ariaLabel="Investimento e cliques por dia"
                legend
              />
              <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                <span>{series.length ? ddmmyyyy(series[0].date) : ""}</span>
                <span>{series.length ? ddmmyyyy(series[series.length - 1].date) : ""}</span>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="mb-4 text-sm font-semibold tracking-tight">
                Investimento por marca
              </h3>
              <SpendDonut brands={brands} total={total.spend} sel={sel} brand={brand} />
            </div>
          </div>

          <BrandTable brands={brands} />
        </>
      )}
    </div>
  );
}

function BrandTable({ brands }: { brands: BrandMetrics[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[820px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-3 font-medium">Marca</th>
            <th className="px-4 py-3 text-right font-medium">Investimento</th>
            <th className="px-4 py-3 text-right font-medium">Leads</th>
            <th className="px-4 py-3 text-right font-medium">CPL</th>
            <th className="px-4 py-3 text-right font-medium">Conversas</th>
            <th className="px-4 py-3 text-right font-medium">Cliques</th>
            <th className="px-4 py-3 text-right font-medium">Alcance</th>
            <th className="px-4 py-3 text-right font-medium">CTR</th>
            <th className="px-4 py-3 text-right font-medium">CPC</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {brands.map((b) => (
            <tr key={b.brand}
              className="border-b border-border last:border-0 hover:bg-muted/40">
              <td className="px-4 py-3 font-medium text-foreground">{b.brand}</td>
              <td className="px-4 py-3 text-right">{money(b.spend)}</td>
              <td className="px-4 py-3 text-right">{count(b.leads)}</td>
              <td className="px-4 py-3 text-right">{money(b.cpl)}</td>
              <td className="px-4 py-3 text-right">{count(b.conversations)}</td>
              <td className="px-4 py-3 text-right">{count(b.clicks)}</td>
              <td className="px-4 py-3 text-right">{count(b.reach)}</td>
              <td className="px-4 py-3 text-right">{pct(b.ctr)}</td>
              <td className="px-4 py-3 text-right">{money(b.cpc)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
