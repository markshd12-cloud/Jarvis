import type { BreakdownSegment, MetaBreakdowns } from "@/lib/marketing/meta-detail";

/**
 * Meta Ads — breakdowns de público e posicionamento (Fase 2). Server component;
 * dados de `getMetaBreakdowns()` (ao vivo, cache 10 min). Cada dimensão (idade,
 * gênero, plataforma/posição, dispositivo, região) vira um card com barras por
 * segmento, ordenadas por investimento, mostrando leads e CPL. Aparece na aba
 * Meta, abaixo do detalhe por campanha/anúncio.
 */
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brlCompact = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});
const int = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const money = (v: number | null) => (v == null ? "—" : brl.format(v));
const moneyC = (v: number) => brlCompact.format(v);
const count = (v: number) => int.format(v);

const ddmm = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
};

const CHART_VARS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

/** Barras horizontais de um breakdown (segmento · investimento · leads/CPL). */
function BreakdownBars({ items }: { items: BreakdownSegment[] }) {
  const max = Math.max(1, ...items.map((i) => i.spend));
  return (
    <ul className="flex flex-col gap-3">
      {items.map((s, i) => (
        <li key={s.label} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate text-muted-foreground" title={s.label}>
              {s.label}
            </span>
            <span className="shrink-0 tabular-nums font-medium">{moneyC(s.spend)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{
                width: `${(s.spend / max) * 100}%`,
                background: CHART_VARS[i % CHART_VARS.length],
              }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums">
            <span>{count(s.leads)} leads</span>
            <span>CPL {money(s.cpl)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function BreakdownCard({ title, items }: { title: string; items: BreakdownSegment[] }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h4 className="mb-3 text-sm font-semibold tracking-tight">{title}</h4>
      <BreakdownBars items={items} />
    </div>
  );
}

export function MetaBreakdownsPanel({ data }: { data: MetaBreakdowns }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">Meta Ads · público e posicionamento</h2>
        <span className="text-sm text-muted-foreground">
          {data.brand ? `${data.brand} · ` : "Todas as marcas · "}
          {ddmm(data.since)} a {ddmm(data.until)}
        </span>
      </div>

      {!data.hasData ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
          {data.erro
            ? `Não foi possível ler os breakdowns (${data.erro}).`
            : "Sem dados de segmentação no período."}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <BreakdownCard title="Por faixa etária" items={data.age} />
            <BreakdownCard title="Por gênero" items={data.gender} />
            <BreakdownCard title="Por plataforma e posição" items={data.platform} />
            <BreakdownCard title="Por dispositivo" items={data.device} />
          </div>
          {data.region.length > 0 ? (
            <div className="rounded-xl border border-border bg-card p-4">
              <h4 className="mb-3 text-sm font-semibold tracking-tight">
                Por região <span className="font-normal text-muted-foreground">· top por investimento</span>
              </h4>
              <BreakdownBars items={data.region} />
            </div>
          ) : null}
          <p className="text-[11px] text-muted-foreground">
            Segmentos ordenados por investimento · CPL = custo por lead no segmento. Útil para achar
            público/posição com melhor custo e realocar verba.
          </p>
        </>
      )}
    </div>
  );
}
