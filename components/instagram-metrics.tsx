import { InteractiveLineChart } from "@/components/charts/interactive-line";
import type {
  IgBrandFollowers,
  IgMedia,
  InstagramOverview,
} from "@/lib/marketing/social";

/**
 * Painel do Instagram orgânico. Server component (sem estado de cliente): reflete
 * o mesmo filtro de marca do painel de Meta Ads (searchParams). Seguidores, posts
 * e engajamento vêm reais de `getInstagramOverview()`; gráficos são SVG/CSS a
 * partir dos dados. Mesma linguagem visual do painel de anúncios (tokens verdes).
 */

const int = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("pt-BR", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const count = (v: number) => int.format(v);

const ddmm = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
};

/** Paleta de séries (verde da marca → apoio), igual ao donut do Meta Ads. */
const CHART_VARS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

/** Rótulo curto do tipo de mídia. */
function mediaLabel(m: IgMedia): string {
  if (m.mediaProductType === "REELS") return "Reels";
  if (m.mediaProductType === "STORY") return "Story";
  if (m.mediaType === "CAROUSEL_ALBUM") return "Carrossel";
  if (m.mediaType === "VIDEO") return "Vídeo";
  return "Post";
}

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
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
        {value}
      </p>
    </div>
  );
}

/** Barras horizontais de seguidores por marca (verde da marca). */
function FollowersBars({ items }: { items: IgBrandFollowers[] }) {
  const max = Math.max(1, ...items.map((i) => i.followers));
  return (
    <ul className="flex flex-col gap-3">
      {items.map((it, i) => (
        <li key={it.brand} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="text-muted-foreground">{it.brand}</span>
            <span className="tabular-nums font-medium">{count(it.followers)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{
                width: `${(it.followers / max) * 100}%`,
                background: CHART_VARS[i % CHART_VARS.length],
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Card de um post (sem thumbnail: layout tipográfico com métricas reais). */
function MediaCard({ m }: { m: IgMedia }) {
  const metrics: { label: string; value: number | null }[] = [
    { label: "Curtidas", value: m.likes },
    { label: "Coment.", value: m.comments },
    { label: "Salvos", value: m.saved },
    { label: "Alcance", value: m.reach },
  ];
  const body = (
    <div className="flex h-full flex-col gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-[var(--brand)]/50">
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {mediaLabel(m)}
        </span>
        <span className="truncate text-[11px] text-muted-foreground">
          {m.brand}
        </span>
      </div>
      <p className="line-clamp-3 flex-1 text-sm leading-snug text-foreground/90">
        {m.caption?.trim() || "(sem legenda)"}
      </p>
      <div className="grid grid-cols-4 gap-1 border-t border-border pt-3">
        {metrics.map((mt) => (
          <div key={mt.label} className="flex flex-col">
            <span className="text-sm font-semibold tabular-nums">
              {mt.value == null ? "—" : compact.format(mt.value)}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {mt.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
  return m.permalink ? (
    <a href={m.permalink} target="_blank" rel="noopener noreferrer" className="block">
      {body}
    </a>
  ) : (
    body
  );
}

export function InstagramMetrics({ data }: { data: InstagramOverview }) {
  const { totalFollowers, followersByBrand, series, posts, topMedia, brand } =
    data;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">
          Instagram · orgânico
        </h2>
        <p className="text-sm text-muted-foreground">
          {brand ? `${brand} · ` : "Todas as marcas · "}
          {followersByBrand.length}{" "}
          {followersByBrand.length === 1 ? "conta" : "contas"}
        </p>
      </div>

      {!data.hasData ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
          Nenhum dado do Instagram ainda. Rode a sincronização em Configurações →
          Conexões → Meta Ads (o Instagram roda junto).
        </div>
      ) : (
        <>
          {/* KPIs (sem delta: métricas orgânicas ainda sem período anterior) */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi label="Seguidores" value={count(totalFollowers)} highlight />
            <Kpi label="Posts recentes" value={count(posts.count)} />
            <Kpi label="Curtidas" value={count(posts.likes)} />
            <Kpi label="Comentários" value={count(posts.comments)} />
            <Kpi label="Salvos" value={count(posts.saved)} />
            <Kpi label="Alcance" value={count(posts.reach)} />
          </div>

          {/* Crescimento + seguidores por marca */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.55fr_1fr]">
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-semibold tracking-tight">
                  Crescimento de seguidores
                </h3>
                <span className="text-xs text-muted-foreground">
                  total das marcas
                </span>
              </div>
              {series.length >= 2 ? (
                <>
                  <InteractiveLineChart
                    points={series.map((p) => ({
                      label: ddmm(p.date),
                      values: { followers: p.followers },
                    }))}
                    series={[
                      { key: "followers", label: "Seguidores", color: "var(--brand)", area: true, baseline: "min", format: "int" },
                    ]}
                    ariaLabel="Crescimento de seguidores por dia"
                  />
                  <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                    <span>{ddmm(series[0].date)}</span>
                    <span>{ddmm(series[series.length - 1].date)}</span>
                  </div>
                </>
              ) : (
                <div className="flex h-[180px] flex-col items-center justify-center gap-2 text-center">
                  <p className="text-3xl font-semibold tabular-nums tracking-tight">
                    {count(totalFollowers)}
                  </p>
                  <p className="max-w-[280px] text-xs text-muted-foreground">
                    A curva de crescimento começa a acumular a partir de hoje —
                    cada sincronização diária adiciona um ponto.
                  </p>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="mb-4 text-sm font-semibold tracking-tight">
                Seguidores por marca
              </h3>
              <FollowersBars items={followersByBrand} />
            </div>
          </div>

          {/* Melhores publicações por engajamento */}
          {topMedia.length ? (
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold tracking-tight">
                Melhores publicações
                <span className="ml-2 font-normal text-muted-foreground">
                  por engajamento
                </span>
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {topMedia.map((m) => (
                  <MediaCard key={m.mediaId} m={m} />
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
