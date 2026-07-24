import { IconAlertTriangle } from "@tabler/icons-react";

import { InteractiveLineChart } from "@/components/charts/interactive-line";
import type { Ga4ChannelRow, Ga4Hour, Ga4Overview, Ga4Realtime } from "@/lib/marketing/ga4";

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

/** Barras horizontais genéricas (rótulo · valor). `mute` esmaece o item. */
function SimpleBars({
  items,
}: {
  items: { label: string; value: number; mute?: boolean }[];
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (items.length === 0)
    return <p className="py-2 text-xs text-muted-foreground">Sem dados no período.</p>;
  return (
    <ul className="flex flex-col gap-3">
      {items.map((it, i) => (
        <li key={it.label} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span
              className={`truncate ${it.mute ? "italic text-muted-foreground/70" : "text-muted-foreground"}`}
              title={it.label}
            >
              {it.label}
            </span>
            <span className="shrink-0 font-medium tabular-nums">{count(it.value)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{
                width: `${(it.value / max) * 100}%`,
                background: it.mute
                  ? "var(--muted-foreground)"
                  : CHART_VARS[i % CHART_VARS.length],
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Mini gráfico de 24 barras: sessões por hora do dia, com o pico destacado. */
function HourBars({ hours }: { hours: Ga4Hour[] }) {
  const byHour = new Map(hours.map((h) => [h.hour, h.sessions]));
  const all = Array.from({ length: 24 }, (_, h) => ({ hour: h, sessions: byHour.get(h) ?? 0 }));
  const max = Math.max(1, ...all.map((h) => h.sessions));
  const pico = Math.max(...all.map((h) => h.sessions));
  const topo = all.filter((h) => h.sessions === pico && pico > 0).map((h) => h.hour);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-24 items-end gap-0.5">
        {all.map((h) => (
          <div
            key={h.hour}
            className="flex-1 rounded-t"
            style={{
              height: `${Math.max(2, (h.sessions / max) * 100)}%`,
              background: topo.includes(h.hour) ? "var(--brand)" : "var(--muted)",
            }}
            title={`${String(h.hour).padStart(2, "0")}h · ${count(h.sessions)} sessões`}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>00h</span><span>06h</span><span>12h</span><span>18h</span><span>23h</span>
      </div>
      {topo.length ? (
        <p className="text-xs text-muted-foreground">
          Pico às{" "}
          <span className="font-medium text-foreground">
            {topo.map((h) => `${String(h).padStart(2, "0")}h`).join(", ")}
          </span>
        </p>
      ) : null}
    </div>
  );
}

/** Card "ao vivo": usuários ativos agora + o que estão vendo (Fase 3). */
function RealtimeCard({ rt }: { rt: Ga4Realtime }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2.5 w-2.5">
            {rt.activeUsers > 0 ? (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--brand)] opacity-70" />
            ) : null}
            <span
              className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
                rt.activeUsers > 0 ? "bg-[var(--brand)]" : "bg-muted-foreground/40"
              }`}
            />
          </span>
          <div>
            <p className="text-2xl font-semibold leading-none tabular-nums">
              {count(rt.activeUsers)}
            </p>
            <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              {rt.activeUsers === 1 ? "pessoa no site agora" : "pessoas no site agora"}
            </p>
          </div>
        </div>

        {rt.byPage.length ? (
          <ul className="ml-auto flex min-w-0 flex-col gap-0.5 text-xs">
            {rt.byPage.slice(0, 3).map((p) => (
              <li key={p.page} className="flex items-baseline gap-2">
                <span className="truncate text-muted-foreground" title={p.page}>
                  {p.page}
                </span>
                <span className="shrink-0 font-medium tabular-nums">{count(p.users)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="ml-auto text-xs text-muted-foreground">
            Ninguém navegando neste momento.
          </span>
        )}
      </div>
    </div>
  );
}

export function Ga4Metrics({
  data,
  realtime,
}: {
  data: Ga4Overview;
  /** Só na página /marketing; no dashboard fica undefined → card oculto. */
  realtime?: Ga4Realtime | null;
}) {
  const {
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
  } = data;
  const maxSite = Math.max(1, ...bySite.map((s) => s.sessions));
  // % de sessões que o GA4 não conseguiu atribuir → sinal de UTM faltando.
  const pctSemAtribuicao = atribuicaoTotalSessions
    ? (semAtribuicaoSessions / atribuicaoTotalSessions) * 100
    : 0;

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
          {/* Tempo real (Fase 3) */}
          {realtime ? <RealtimeCard rt={realtime} /> : null}

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

          {/* Atribuição: origem/mídia + campanhas */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-4 flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold tracking-tight">Origem / mídia</h3>
                <span className="text-[11px] text-muted-foreground">de onde veio a sessão</span>
              </div>
              <SimpleBars
                items={bySourceMedium.map((s) => ({
                  label: s.semAtribuicao ? `${s.sourceMedium} (sem atribuição)` : s.sourceMedium,
                  value: s.sessions,
                  mute: s.semAtribuicao,
                }))}
              />
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-4 flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold tracking-tight">Campanhas</h3>
                <span className="text-[11px] text-muted-foreground">via UTM</span>
              </div>
              <SimpleBars
                items={byCampaign.map((c) => ({
                  label: c.campaign,
                  value: c.sessions,
                  mute: c.campaign === "(not set)" || c.campaign === "(organic)" || c.campaign === "(direct)",
                }))}
              />
            </div>
          </div>

          {/* Aviso de tráfego sem atribuição (UTM faltando) */}
          {pctSemAtribuicao >= 15 ? (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
              <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-xs text-amber-800 dark:text-amber-300">
                <strong>{pctSemAtribuicao.toFixed(0)}% das sessões sem atribuição</strong>{" "}
                ({count(semAtribuicaoSessions)} de {count(atribuicaoTotalSessions)}). Isso é UTM
                faltando ou inconsistente nas campanhas — sem elas não dá pra saber qual canal
                trouxe o tráfego. Padronização em <code>docs/ga4-tracking-setup.md</code>.
              </p>
            </div>
          ) : null}

          {/* Páginas de entrada */}
          {landingPages.length ? (
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-4 flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold tracking-tight">Páginas de entrada</h3>
                <span className="text-[11px] text-muted-foreground">onde a sessão começou</span>
              </div>
              <SimpleBars
                items={landingPages.map((p) => ({ label: p.path, value: p.sessions }))}
              />
            </div>
          ) : null}

          {/* Fase 2 — público: dispositivo, novo/recorrente, cidades */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="mb-4 text-sm font-semibold tracking-tight">Dispositivo</h3>
              <SimpleBars items={byDevice.map((d) => ({ label: d.label, value: d.sessions }))} />
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="mb-4 text-sm font-semibold tracking-tight">Novos × recorrentes</h3>
              <SimpleBars
                items={byNewReturning.map((d) => ({ label: d.label, value: d.sessions }))}
              />
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="mb-4 text-sm font-semibold tracking-tight">Principais cidades</h3>
              <SimpleBars
                items={byCity.map((c) => ({
                  label: c.label,
                  value: c.sessions,
                  mute: c.label.startsWith("("),
                }))}
              />
            </div>
          </div>

          {/* Fase 2 — hora do dia + qualidade do tráfego */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.55fr_1fr]">
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold tracking-tight">Sessões por hora</h3>
                <span className="text-[11px] text-muted-foreground">quando o site recebe mais</span>
              </div>
              <HourBars hours={byHour} />
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="mb-4 text-sm font-semibold tracking-tight">Qualidade do tráfego</h3>
              <dl className="grid grid-cols-2 gap-3">
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Rejeição
                  </dt>
                  <dd className="text-xl font-semibold tabular-nums">
                    {behavior.bounceRate.toFixed(0)}%
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Sessões engajadas
                  </dt>
                  <dd className="text-xl font-semibold tabular-nums">
                    {count(behavior.engagedSessions)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Páginas / sessão
                  </dt>
                  <dd className="text-xl font-semibold tabular-nums">
                    {behavior.pagesPerSession.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Sessões / usuário
                  </dt>
                  <dd className="text-xl font-semibold tabular-nums">
                    {behavior.sessionsPerUser.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}
                  </dd>
                </div>
              </dl>
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
