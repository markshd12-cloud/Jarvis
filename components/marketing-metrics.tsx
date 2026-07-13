import Link from "next/link";

import type {
  BrandMetrics,
  MarketingDashboard,
  RangeKey,
} from "@/lib/marketing/dashboard";

/**
 * Painel de aproveitamento do Meta Ads no Dashboard. Server component (sem
 * estado de cliente): os filtros de período/marca navegam por searchParams via
 * <Link>/<form method="get"> e o server re-consulta `getMarketingDashboard()`.
 * O gate de permissão é feito na página.
 */

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const int = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

const money = (v: number | null) => (v == null ? "—" : brl.format(v));
const count = (v: number | null) => (v == null ? "—" : int.format(v));
const pct = (v: number | null) =>
  v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

/** 'AAAA-MM-DD' → 'DD/MM/AAAA'. */
const ddmmyyyy = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

const RANGE_LABELS: { key: RangeKey; label: string }[] = [
  { key: "7", label: "7 dias" },
  { key: "30", label: "30 dias" },
  { key: "90", label: "90 dias" },
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
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border text-muted-foreground hover:bg-muted/50"
      }`}
    >
      {children}
    </Link>
  );
}

/** Um KPI do agregado geral. */
function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight">
        {value}
      </p>
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
  const { total, brands, range, since, until, brand } = data;
  const sel: Selection = { range, since, until, brand };

  return (
    <div className="flex flex-col gap-4">
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
          <Chip
            key={key}
            href={buildHref(sel, { range: key })}
            active={range === key}
          >
            {label}
          </Chip>
        ))}
        <form
          method="get"
          action="/dashboard"
          className="flex flex-wrap items-center gap-2"
        >
          <input type="hidden" name="range" value="custom" />
          {brand ? <input type="hidden" name="brand" value={brand} /> : null}
          <input
            type="date"
            name="since"
            defaultValue={since}
            max={until}
            className="rounded-md border border-border bg-card px-2 py-1 text-sm"
          />
          <span className="text-sm text-muted-foreground">a</span>
          <input
            type="date"
            name="until"
            defaultValue={until}
            className="rounded-md border border-border bg-card px-2 py-1 text-sm"
          />
          <button
            type="submit"
            className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
              range === "custom"
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:bg-muted/50"
            }`}
          >
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
          <Chip key={b} href={buildHref(sel, { brand: b })} active={brand === b}>
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi label="Investimento" value={money(total.spend)} />
            <Kpi label="Impressões" value={count(total.impressions)} />
            <Kpi label="Cliques" value={count(total.clicks)} />
            <Kpi label="Alcance" value={count(total.reach)} />
            <Kpi label="CTR" value={pct(total.ctr)} />
            <Kpi label="CPC" value={money(total.cpc)} />
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
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-3 font-medium">Marca</th>
            <th className="px-4 py-3 text-right font-medium">Investimento</th>
            <th className="px-4 py-3 text-right font-medium">Impressões</th>
            <th className="px-4 py-3 text-right font-medium">Cliques</th>
            <th className="px-4 py-3 text-right font-medium">Alcance</th>
            <th className="px-4 py-3 text-right font-medium">CTR</th>
            <th className="px-4 py-3 text-right font-medium">CPC</th>
            <th className="px-4 py-3 text-right font-medium">CPM</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {brands.map((b) => (
            <tr
              key={b.brand}
              className="border-b border-border last:border-0 hover:bg-muted/40"
            >
              <td className="px-4 py-3 font-medium text-foreground">
                {b.brand}
              </td>
              <td className="px-4 py-3 text-right">{money(b.spend)}</td>
              <td className="px-4 py-3 text-right">{count(b.impressions)}</td>
              <td className="px-4 py-3 text-right">{count(b.clicks)}</td>
              <td className="px-4 py-3 text-right">{count(b.reach)}</td>
              <td className="px-4 py-3 text-right">{pct(b.ctr)}</td>
              <td className="px-4 py-3 text-right">{money(b.cpc)}</td>
              <td className="px-4 py-3 text-right">{money(b.cpm)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
