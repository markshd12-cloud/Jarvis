import Link from "next/link";

import type {
  BrandMetrics,
  DailyPoint,
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

/** Área de investimento + linha de cliques a partir da série diária real. */
function TrendChart({ series }: { series: DailyPoint[] }) {
  const W = 640;
  const H = 190;
  const PAD = 8;
  const n = series.length;
  const spends = series.map((p) => p.spend);
  const clicks = series.map((p) => p.clicks);
  const maxS = Math.max(1, ...spends);
  const maxC = Math.max(1, ...clicks);
  const x = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W);
  const yS = (v: number) => H - PAD - (v / maxS) * (H - 2 * PAD);
  const yC = (v: number) => H - PAD - (v / maxC) * (H - 2 * PAD);
  const path = (arr: number[], y: (v: number) => number) =>
    arr
      .map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
      .join(" ");
  const spendLine = path(spends, yS);
  const clickLine = path(clicks, yC);
  const area = `${spendLine} L${W},${H} L0,${H} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
      aria-label="Investimento e cliques por dia">
      <defs>
        <linearGradient id="trendfill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--brand)" stopOpacity="0.28" />
          <stop offset="1" stopColor="var(--brand)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1="0" y1={H * f} x2={W} y2={H * f}
          stroke="var(--border)" strokeWidth="1" />
      ))}
      <path d={area} fill="url(#trendfill)" />
      <path d={spendLine} fill="none" stroke="var(--brand)" strokeWidth="2.5"
        strokeLinejoin="round" strokeLinecap="round" />
      <path d={clickLine} fill="none" stroke="var(--chart-3)" strokeWidth="2"
        strokeLinejoin="round" strokeLinecap="round" strokeDasharray="4 3" />
      {n > 0 ? (
        <>
          <circle cx={x(n - 1)} cy={yS(spends[n - 1])} r="4" fill="var(--brand)" />
          <circle cx={x(n - 1)} cy={yC(clicks[n - 1])} r="3.5" fill="var(--chart-3)" />
        </>
      ) : null}
    </svg>
  );
}

/** Donut (pizza) do investimento por marca via conic-gradient. */
function SpendDonut({
  brands,
  total,
}: {
  brands: BrandMetrics[];
  total: number;
}) {
  let acc = 0;
  const stops: string[] = [];
  const legend: { name: string; value: number; color: string; pctv: number }[] =
    [];
  brands.forEach((b, i) => {
    const color = CHART_VARS[i % CHART_VARS.length];
    const share = total ? (b.spend / total) * 100 : 0;
    const from = acc;
    acc += share;
    stops.push(`${color} ${from.toFixed(2)}% ${acc.toFixed(2)}%`);
    legend.push({
      name: b.brand ?? "?",
      value: b.spend,
      color,
      pctv: share,
    });
  });
  const top = legend[0];

  return (
    <div className="flex items-center gap-5">
      <div
        className="relative grid h-28 w-28 flex-none place-items-center rounded-full"
        style={{ background: `conic-gradient(${stops.join(", ")})` }}
      >
        <div className="grid h-[70px] w-[70px] place-items-center rounded-full bg-card text-center">
          <div>
            <p className="text-sm font-semibold tabular-nums leading-none">
              {top ? `${Math.round(top.pctv)}%` : "—"}
            </p>
            <p className="mt-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
              {top?.name.split(" ")[0] ?? ""}
            </p>
          </div>
        </div>
      </div>
      <ul className="flex flex-col gap-2 text-sm">
        {legend.map((l) => (
          <li key={l.name} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 flex-none rounded-sm"
              style={{ background: l.color }} />
            <span className="text-muted-foreground">{l.name}</span>
            <span className="tabular-nums font-medium">{brlCompact.format(l.value)}</span>
          </li>
        ))}
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
        <form method="get" action="/dashboard"
          className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="range" value="custom" />
          {brand ? <input type="hidden" name="brand" value={brand} /> : null}
          <input type="date" name="since" defaultValue={since} max={until}
            className="rounded-md border border-border bg-card px-2 py-1 text-sm" />
          <span className="text-sm text-muted-foreground">a</span>
          <input type="date" name="until" defaultValue={until}
            className="rounded-md border border-border bg-card px-2 py-1 text-sm" />
          <button type="submit"
            className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
              range === "custom"
                ? "border-transparent bg-foreground text-background"
                : "border-border text-muted-foreground hover:bg-muted/60"
            }`}>
            Aplicar
          </button>
        </form>
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
            <Kpi label="Leads" value={count(total.leads)}
              cur={total.leads} prev={previous.leads} highlight />
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
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-semibold tracking-tight">
                  Investimento por dia
                </h3>
                <div className="flex gap-4 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm" style={{ background: "var(--brand)" }} />
                    Investimento
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm" style={{ background: "var(--chart-3)" }} />
                    Cliques
                  </span>
                </div>
              </div>
              <TrendChart series={series} />
              <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                <span>{series.length ? ddmmyyyy(series[0].date) : ""}</span>
                <span>{series.length ? ddmmyyyy(series[series.length - 1].date) : ""}</span>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="mb-4 text-sm font-semibold tracking-tight">
                Investimento por marca
              </h3>
              <SpendDonut brands={brands} total={total.spend} />
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
