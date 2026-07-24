import { InteractiveLineChart } from "@/components/charts/interactive-line";
import type { YoutubeOverview, YtVideo } from "@/lib/marketing/youtube";

/**
 * Painel do YouTube (Nível A — dados públicos). Server component, mesma
 * linguagem visual do Instagram/Meta. Dados de `getYoutubeOverview()` (lê das
 * tabelas sociais). Gated por `marketing` na página.
 */
const int = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const count = (v: number) => int.format(v);

const ddmm = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
};

/** Segundos → "2h22" / "9m48" / "35s". */
function duracao(seg: number): string {
  if (seg <= 0) return "—";
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  const s = seg % 60;
  if (h) return `${h}h${String(m).padStart(2, "0")}`;
  if (m) return `${m}m${String(s).padStart(2, "0")}`;
  return `${s}s`;
}

const CHART_VARS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)"];

function Kpi({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      className={`flex flex-col rounded-xl border border-border p-4 ${
        highlight ? "bg-[var(--brand)]/10" : "bg-card"
      }`}
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
    </div>
  );
}

/** Card de um vídeo — abre no YouTube ao clicar. */
function VideoCard({ v }: { v: YtVideo }) {
  return (
    <a href={v.permalink} target="_blank" rel="noopener noreferrer" className="group block h-full">
      <div className="flex h-full flex-col gap-3 overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-[var(--brand)]/50">
        {v.thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={v.thumb}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="aspect-video w-full object-cover"
          />
        ) : null}
        <div className="flex flex-1 flex-col gap-3 px-4 pb-4 pt-1">
          <div className="flex items-center justify-between gap-2">
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {v.isShort ? "Shorts" : "Vídeo"} · {duracao(v.duracaoSeg)}
            </span>
            <span className="truncate text-[11px] text-muted-foreground">{v.brand}</span>
          </div>
          <p className="line-clamp-2 flex-1 text-sm leading-snug text-foreground/90">{v.title}</p>
          <div className="grid grid-cols-4 gap-1 border-t border-border pt-3">
            {[
              { label: "Views", value: compact.format(v.views) },
              { label: "Likes", value: compact.format(v.likes) },
              { label: "Coment.", value: compact.format(v.comments) },
              { label: "Engaj.", value: `${v.engajamento.toFixed(1)}%` },
            ].map((m) => (
              <div key={m.label} className="flex flex-col">
                <span className="text-sm font-semibold tabular-nums">{m.value}</span>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {m.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </a>
  );
}

export function YoutubeMetrics({ data }: { data: YoutubeOverview }) {
  const { totalSubscribers, totalViews, channels, series, topVideos, byFormat, brand } = data;
  const maxCanal = Math.max(1, ...channels.map((c) => c.subscribers));
  const totalVideos = channels.reduce((s, c) => s + c.videoCount, 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">YouTube · canal</h2>
        <p className="text-sm text-muted-foreground">
          {brand ? `${brand} · ` : "Todas as marcas · "}
          {channels.length} {channels.length === 1 ? "canal" : "canais"}
        </p>
      </div>

      {!data.hasData ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
          Nenhum dado do YouTube ainda. Rode a sincronização em Configurações → Conexões
          (o YouTube roda junto do Meta/Instagram).
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label="Inscritos" value={count(totalSubscribers)} highlight />
            <Kpi label="Visualizações" value={count(totalViews)} />
            <Kpi label="Vídeos" value={count(totalVideos)} />
            <Kpi
              label="Views / vídeo"
              value={totalVideos ? compact.format(Math.round(totalViews / totalVideos)) : "—"}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.55fr_1fr]">
            {/* Crescimento de inscritos */}
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-semibold tracking-tight">Crescimento de inscritos</h3>
                <span className="text-xs text-muted-foreground">total dos canais</span>
              </div>
              {series.length >= 2 ? (
                <>
                  <InteractiveLineChart
                    points={series.map((p) => ({
                      label: ddmm(p.date),
                      values: { subs: p.subscribers },
                    }))}
                    series={[
                      { key: "subs", label: "Inscritos", color: "var(--brand)", area: true, baseline: "min", format: "int" },
                    ]}
                    ariaLabel="Inscritos por dia"
                  />
                  <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                    <span>{ddmm(series[0].date)}</span>
                    <span>{ddmm(series[series.length - 1].date)}</span>
                  </div>
                </>
              ) : (
                <div className="flex h-[180px] flex-col items-center justify-center gap-2 text-center">
                  <p className="text-3xl font-semibold tabular-nums tracking-tight">
                    {count(totalSubscribers)}
                  </p>
                  <p className="max-w-[280px] text-xs text-muted-foreground">
                    A curva começa a acumular a partir de hoje — a API do YouTube não fornece
                    histórico de inscritos; cada sincronização adiciona um ponto.
                  </p>
                </div>
              )}
            </div>

            {/* Inscritos por canal + formato */}
            <div className="flex flex-col gap-4">
              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="mb-4 text-sm font-semibold tracking-tight">Inscritos por canal</h3>
                <ul className="flex flex-col gap-3">
                  {channels.map((c, i) => (
                    <li key={c.brand} className="flex flex-col gap-1">
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="text-muted-foreground">{c.brand}</span>
                        <span className="font-medium tabular-nums">{count(c.subscribers)}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${(c.subscribers / maxCanal) * 100}%`,
                            background: CHART_VARS[i % CHART_VARS.length],
                          }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              {byFormat.length ? (
                <div className="rounded-xl border border-border bg-card p-4">
                  <h3 className="mb-3 text-sm font-semibold tracking-tight">
                    Shorts × vídeo longo
                    <span className="ml-2 font-normal text-muted-foreground">views médias</span>
                  </h3>
                  <ul className="flex flex-col gap-2">
                    {byFormat.map((f) => (
                      <li key={f.format} className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="text-muted-foreground">
                          {f.format} <span className="text-xs">· {f.count}</span>
                        </span>
                        <span className="font-medium tabular-nums">
                          {compact.format(Math.round(f.avgViews))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>

          {/* Vídeos mais vistos */}
          {topVideos.length ? (
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold tracking-tight">
                Vídeos mais vistos
                <span className="ml-2 font-normal text-muted-foreground">entre os recentes</span>
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {topVideos.map((v) => (
                  <VideoCard key={v.videoId} v={v} />
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
