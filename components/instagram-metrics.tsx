import { InstagramFunnelPanel } from "@/components/instagram-funnel";
import { MarketingBrandFilter } from "@/components/marketing-brand-filter";
import { MARKETING_AD_ACCOUNTS } from "@/lib/marketing/config";
import { InteractiveLineChart } from "@/components/charts/interactive-line";
import type { InstagramFunnel } from "@/lib/marketing/instagram-funnel";
import type { MetaComAtual } from "@/lib/marketing/metas";
import type {
  IgBrandFollowers,
  IgFormatStat,
  IgHour,
  IgMedia,
  IgSegment,
  InstagramAudience,
  InstagramOverview,
  InstagramStories,
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

/**
 * Variação contra o mesmo número no período anterior.
 *
 * A aba não tinha comparação NENHUMA: mostrava "54.086 contas engajadas" e o
 * leitor não tinha como saber se era bom. `null` quando não há base — período
 * anterior sem dado, ou base zero (que daria "+∞%").
 */
function Delta({ atual, anterior }: { atual: number; anterior: number | null }) {
  if (anterior == null || anterior === 0) return null;
  const v = (atual - anterior) / anterior;
  const neutro = Math.abs(v) < 0.005;
  return (
    <p
      className={`mt-0.5 text-[11px] font-medium tabular-nums ${
        neutro
          ? "text-muted-foreground"
          : v > 0
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-red-500 dark:text-red-400"
      }`}
    >
      {neutro ? "—" : `${v > 0 ? "▲" : "▼"} ${Math.abs(Math.round(v * 100))}%`}
      <span className="font-normal opacity-70"> vs anterior</span>
    </p>
  );
}

function Kpi({
  label,
  value,
  highlight = false,
  atual,
  anterior,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  /** Par para o delta. Omitir os dois esconde a linha de variação. */
  atual?: number;
  anterior?: number | null;
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
      {atual != null ? <Delta atual={atual} anterior={anterior ?? null} /> : null}
    </div>
  );
}

/**
 * Barras horizontais de seguidores por marca, com o progresso da META do mês.
 *
 * A meta de `seguidores_ig` vive na aba Metas e o painel não sabia que ela
 * existia — era preciso trocar de aba só para saber se o número é bom.
 */
function FollowersBars({
  items,
  metaPorMarca,
}: {
  items: IgBrandFollowers[];
  metaPorMarca: Map<string, { meta: number; atual: number }>;
}) {
  const max = Math.max(1, ...items.map((i) => i.followers));
  return (
    <ul className="flex flex-col gap-3">
      {items.map((it, i) => {
        const m = metaPorMarca.get(it.brand);
        const pct = m && m.meta > 0 ? m.atual / m.meta : null;
        return (
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
          {pct != null ? (
            <div className="flex items-baseline justify-between gap-2 text-[11px] tabular-nums">
              <span className="text-muted-foreground">
                meta do mês {count(m!.meta)}
              </span>
              <span
                className={
                  pct >= 1
                    ? "font-medium text-emerald-600 dark:text-emerald-400"
                    : "text-muted-foreground"
                }
              >
                {count(m!.atual)} ({Math.round(pct * 100)}%)
              </span>
            </div>
          ) : null}
        </li>
        );
      })}
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

/** Barras horizontais genéricas (segmento · valor), escaladas pelo maior. */
function SegmentBars({
  items,
  format = count,
}: {
  items: IgSegment[];
  format?: (v: number) => string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (items.length === 0)
    return <p className="py-2 text-xs text-muted-foreground">Sem dados.</p>;
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((it, i) => (
        <li key={it.label} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate text-muted-foreground" title={it.label}>
              {it.label}
            </span>
            <span className="shrink-0 tabular-nums font-medium">{format(it.value)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{
                width: `${(it.value / max) * 100}%`,
                background: CHART_VARS[i % CHART_VARS.length],
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Mini gráfico de 24 barras (0-23h): melhor horário para postar. */
function BestHours({ hours }: { hours: IgHour[] }) {
  const byHour = new Map(hours.map((h) => [h.hour, h.value]));
  const all = Array.from({ length: 24 }, (_, h) => ({ hour: h, value: byHour.get(h) ?? 0 }));
  const max = Math.max(1, ...all.map((h) => h.value));
  const peak = Math.max(...all.map((h) => h.value));
  const top = all.filter((h) => h.value === peak && peak > 0).map((h) => h.hour);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-24 items-end gap-0.5">
        {all.map((h) => (
          <div
            key={h.hour}
            className="flex-1 rounded-t"
            style={{
              height: `${Math.max(2, (h.value / max) * 100)}%`,
              background: top.includes(h.hour) ? "var(--brand)" : "var(--muted)",
            }}
            title={`${String(h.hour).padStart(2, "0")}h · ${count(h.value)}`}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>00h</span>
        <span>06h</span>
        <span>12h</span>
        <span>18h</span>
        <span>23h</span>
      </div>
      {top.length ? (
        <p className="text-xs text-muted-foreground">
          Pico às{" "}
          <span className="font-medium text-foreground">
            {top.map((h) => `${String(h).padStart(2, "0")}h`).join(", ")}
          </span>{" "}
          — melhor janela para postar.
        </p>
      ) : null}
    </div>
  );
}

/** Barras de desempenho por formato (engajamento médio por post). */
function FormatBars({ items }: { items: IgFormatStat[] }) {
  const max = Math.max(1, ...items.map((i) => i.avgEngagement));
  return (
    <ul className="flex flex-col gap-3">
      {items.map((it, i) => (
        <li key={it.format} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="text-muted-foreground">
              {it.format} <span className="text-xs">· {it.count} posts</span>
            </span>
            <span className="tabular-nums font-medium">
              {compact.format(Math.round(it.avgEngagement))}{" "}
              <span className="text-xs text-muted-foreground">eng./post</span>
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{
                width: `${(it.avgEngagement / max) * 100}%`,
                background: CHART_VARS[i % CHART_VARS.length],
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function InstagramMetrics({
  data,
  funnel,
  audience,
  stories,
  metas,
}: {
  data: InstagramOverview;
  /** Só na página /marketing (detalhe); no dashboard ficam undefined → ocultos. */
  funnel?: InstagramFunnel | null;
  audience?: InstagramAudience | null;
  stories?: InstagramStories | null;
  /** Metas do mês — só as de `seguidores_ig` são usadas aqui. */
  metas?: MetaComAtual[] | null;
}) {
  const {
    totalFollowers,
    ganhoSeguidores,
    followersByBrand,
    series,
    posts,
    anterior,
    topMedia,
    byFormat,
    brand,
    since,
    until,
  } = data;

  /**
   * Metas de seguidores COM valor, indexadas pela marca.
   *
   * A aba Metas cadastra por PERFIL (account_id) e o painel agrupa por marca —
   * uma marca com dois perfis (o "Everton") soma as duas metas, que é a leitura
   * certa: o card mostra os seguidores somados da marca.
   */
  const metaPorMarca = new Map<string, { meta: number; atual: number }>();
  for (const m of metas ?? []) {
    if (m.metrica !== "seguidores_ig" || m.valor == null) continue;
    const cur = metaPorMarca.get(m.rotulo) ?? { meta: 0, atual: 0 };
    cur.meta += m.valor;
    cur.atual += m.atual ?? 0;
    metaPorMarca.set(m.rotulo, cur);
  }

  /**
   * Só marcas COM conta de Instagram entram no filtro.
   *
   * Derivado do config, não do dado: uma marca sem post no período continua
   * clicável, e o clique explica o vazio ("sem publicação") em vez de a marca
   * simplesmente não existir no filtro.
   */
  const marcas = MARKETING_AD_ACCOUNTS.filter((b) => b.instagram.length).map(
    (b) => b.label,
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight">
            Instagram · orgânico
          </h2>
          <p className="text-sm text-muted-foreground">
            {brand ? `${brand} · ` : "Todas as marcas · "}
            {ddmm(since)} a {ddmm(until)} · {followersByBrand.length}{" "}
            {followersByBrand.length === 1 ? "conta" : "contas"}
            {anterior ? ` · vs ${ddmm(anterior.since)} a ${ddmm(anterior.until)}` : ""}
          </p>
        </div>
        <MarketingBrandFilter marcas={marcas} aba="instagram" />
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
            {/* O delta é do GANHO no período, não do total: comparar totais daria
                sempre "+0,1%" e esconderia se o período foi bom ou ruim. */}
            <Kpi
              label="Ganho no período"
              value={`${ganhoSeguidores >= 0 ? "+" : ""}${count(ganhoSeguidores)}`}
              atual={ganhoSeguidores}
              anterior={anterior?.ganhoSeguidores ?? null}
            />
            <Kpi
              label="Posts"
              value={count(posts.count)}
              atual={posts.count}
              anterior={anterior?.posts ?? null}
            />
            <Kpi
              label="Engajamento"
              value={count(posts.engagement)}
              atual={posts.engagement}
              anterior={anterior?.engagement ?? null}
            />
            <Kpi label="Salvos" value={count(posts.saved)} />
            <Kpi
              label="Alcance dos posts"
              value={count(posts.reach)}
              atual={posts.reach}
              anterior={anterior?.reach ?? null}
            />
          </div>

          {/* Funil da conta (só no /marketing) */}
          {funnel ? <InstagramFunnelPanel data={funnel} /> : null}

          {/* Crescimento + seguidores por marca */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.55fr_1fr]">
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-semibold tracking-tight">
                  Crescimento, alcance e engajamento
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
                      values: {
                        followers: p.followers,
                        reach: p.reach,
                        engagement: p.engagement,
                      },
                    }))}
                    /**
                     * `reach` JÁ ERA gravado em `social_daily_insights` desde o
                     * primeiro sync e nunca aparecia em lugar nenhum — dado pago
                     * em chamada de API e descartado.
                     *
                     * Cada série tem escala própria (seguidores na casa dos
                     * 90 mil, engajamento na das centenas), e a distinção é por
                     * FORMA além de cor: a paleta do repo é monocromática (hue
                     * 142.5), então cor sozinha não separa.
                     */
                    series={[
                      { key: "followers", label: "Seguidores", color: "var(--brand)", area: true, baseline: "min", format: "int" },
                      { key: "reach", label: "Alcance", color: "var(--chart-3)", dashed: true, format: "int" },
                      { key: "engagement", label: "Engajamento", color: "var(--chart-5)", format: "int" },
                    ]}
                    legend
                    ariaLabel="Seguidores, alcance e engajamento por dia"
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
              <FollowersBars items={followersByBrand} metaPorMarca={metaPorMarca} />
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

          {/* Desempenho por formato (Reels/Carrossel/Imagem) */}
          {byFormat.length ? (
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="mb-4 text-sm font-semibold tracking-tight">
                Desempenho por formato
                <span className="ml-2 font-normal text-muted-foreground">
                  engajamento médio por post
                </span>
              </h3>
              <FormatBars items={byFormat} />
            </div>
          ) : null}

          {/* Demografia + melhor horário (só no /marketing) */}
          {audience?.hasData ? (
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold tracking-tight">
                Audiência
                <span className="ml-2 font-normal text-muted-foreground">
                  seguidores{audience.capturedOn ? ` · ${ddmm(audience.capturedOn)}` : ""}
                </span>
              </h3>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {audience.age.length ? (
                  <div className="rounded-xl border border-border bg-card p-4">
                    <h4 className="mb-3 text-sm font-semibold tracking-tight">Por faixa etária</h4>
                    <SegmentBars items={audience.age} />
                  </div>
                ) : null}
                {audience.gender.length ? (
                  <div className="rounded-xl border border-border bg-card p-4">
                    <h4 className="mb-3 text-sm font-semibold tracking-tight">Por gênero</h4>
                    <SegmentBars items={audience.gender} />
                  </div>
                ) : null}
                {audience.city.length ? (
                  <div className="rounded-xl border border-border bg-card p-4">
                    <h4 className="mb-3 text-sm font-semibold tracking-tight">Principais cidades</h4>
                    <SegmentBars items={audience.city} />
                  </div>
                ) : null}
                {audience.country.length ? (
                  <div className="rounded-xl border border-border bg-card p-4">
                    <h4 className="mb-3 text-sm font-semibold tracking-tight">Principais países</h4>
                    <SegmentBars items={audience.country} />
                  </div>
                ) : null}
              </div>
              {audience.bestHours.length ? (
                <div className="rounded-xl border border-border bg-card p-4">
                  <h4 className="mb-3 text-sm font-semibold tracking-tight">
                    Melhor horário para postar
                    <span className="ml-2 font-normal text-muted-foreground">
                      seguidores online por hora
                    </span>
                  </h4>
                  <BestHours hours={audience.bestHours} />
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Stories (só no /marketing) */}
          {stories?.hasData ? (
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold tracking-tight">
                Stories
                <span className="ml-2 font-normal text-muted-foreground">
                  {stories.count} capturados nas últimas 24h
                </span>
              </h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Kpi label="Stories" value={count(stories.count)} highlight />
                <Kpi label="Alcance" value={count(stories.reach)} />
                <Kpi label="Respostas" value={count(stories.replies)} />
                <Kpi label="Navegações" value={count(stories.navigation)} />
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
