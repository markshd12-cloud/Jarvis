import { InteractiveLineChart } from "@/components/charts/interactive-line";
import type { Ga4ChannelRow, Ga4Overview } from "@/lib/marketing/ga4";

/**
 * Painel do GA4 (Google Analytics do site). Server component — mesma linguagem
 * visual do Instagram/Meta (tokens verdes). Dados de `getGa4Overview()` (28 dias,
 * ao vivo). Vive DENTRO do /dashboard, abaixo do Instagram; gated por `ga4`.
 */
const int = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const count = (v: number) => int.format(v);
const ddmm = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
};
function duracao(seg: number): string {
  const m = Math.floor(seg / 60);
  const s = Math.round(seg % 60);
  return `${m}m${String(s).padStart(2, "0")}s`;
}

const CHART_VARS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function Kpi({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
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
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
    </div>
  );
}

/** Barras horizontais de sessões por canal de tráfego. */
function ChannelBars({ items }: { items: Ga4ChannelRow[] }) {
  const max = Math.max(1, ...items.map((i) => i.sessions));
  return (
    <ul className="flex flex-col gap-3">
      {items.map((it, i) => (
        <li key={it.channel} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="text-muted-foreground">{it.channel}</span>
            <span className="font-medium tabular-nums">{count(it.sessions)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{
                width: `${(it.sessions / max) * 100}%`,
                background: CHART_VARS[i % CHART_VARS.length],
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Ga4Metrics({ data }: { data: Ga4Overview }) {
  const { totals, byChannel, bySite, series, topPages } = data;
  const maxSite = Math.max(1, ...bySite.map((s) => s.sessions));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">Google Analytics · site</h2>
        <p className="text-sm text-muted-foreground">GA4 · últimos 28 dias</p>
      </div>

      {!data.hasData ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
          Sem dados do GA4 no período — ou a propriedade ainda não liberou acesso à
          service account.
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi label="Sessões" value={count(totals.sessions)} highlight />
            <Kpi label="Usuários" value={count(totals.users)} />
            <Kpi label="Novos" value={count(totals.newUsers)} />
            <Kpi label="Pageviews" value={count(totals.pageviews)} />
            <Kpi label="Conversões" value={count(totals.conversions)} />
            <Kpi label="Engajamento" value={`${totals.engajamento.toFixed(1)}%`} />
          </div>

          {/* Sessões por site — desambigua os vários domínios (cppem.com.br, colegio…) */}
          {bySite.length > 1 ? (
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="mb-4 text-sm font-semibold tracking-tight">Sessões por site</h3>
              <ul className="flex flex-col gap-3">
                {bySite.map((s, i) => (
                  <li key={s.site} className="flex flex-col gap-1">
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="font-mono text-xs text-muted-foreground">{s.site}</span>
                      <span className="font-medium tabular-nums">
                        {count(s.sessions)} <span className="text-muted-foreground">sessões</span>
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${(s.sessions / maxSite) * 100}%`,
                          background: CHART_VARS[i % CHART_VARS.length],
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Série diária + canais */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.55fr_1fr]">
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-semibold tracking-tight">Sessões por dia</h3>
                <span className="text-xs text-muted-foreground">
                  duração média {duracao(totals.duracaoMediaSeg)}
                </span>
              </div>
              {series.length >= 2 ? (
                <>
                  <InteractiveLineChart
                    points={series.map((p) => ({
                      label: ddmm(p.date),
                      values: { sessions: p.sessions, users: p.users },
                    }))}
                    series={[
                      { key: "sessions", label: "Sessões", color: "var(--brand)", area: true, baseline: "min", format: "int" },
                      { key: "users", label: "Usuários", color: "var(--chart-3)", dashed: true, format: "int" },
                    ]}
                    ariaLabel="Sessões e usuários por dia"
                    legend
                  />
                  <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                    <span>{ddmm(series[0].date)}</span>
                    <span>{ddmm(series[series.length - 1].date)}</span>
                  </div>
                </>
              ) : (
                <div className="flex h-[180px] items-center justify-center text-sm text-muted-foreground">
                  Série insuficiente no período.
                </div>
              )}
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="mb-4 text-sm font-semibold tracking-tight">
                Sessões por canal
              </h3>
              <ChannelBars items={byChannel} />
            </div>
          </div>

          {/* Páginas mais vistas */}
          {topPages.length ? (
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="mb-3 text-sm font-semibold tracking-tight">Páginas mais vistas</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="pb-2 font-medium">Página</th>
                      <th className="pb-2 text-right font-medium">Pageviews</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topPages.map((p) => (
                      <tr key={p.path} className="border-t border-border">
                        <td className="py-2 pr-3 font-mono text-xs">{p.path}</td>
                        <td className="py-2 text-right tabular-nums">{count(p.views)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
