import { IconExternalLink, IconPhotoOff } from "@tabler/icons-react";

import type { MetaDetail, MetaPerformer, RankBucket } from "@/lib/marketing/meta-detail";

/**
 * Detalhe ao vivo do Meta Ads (Fase 1): top campanhas e top anúncios por
 * investimento, com CPL, custo por conversa (WPP) e ROAS. Server component —
 * dados de `getMetaDetail()` (ao vivo, cache 10 min). Aparece na aba Meta,
 * abaixo do overview sincronizado. Cards em GRADE (como os posts do Instagram),
 * cada um linkando para a campanha/anúncio no Gerenciador de Anúncios.
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
const moneyC = (v: number | null) => (v == null ? "—" : brlCompact.format(v));
const count = (v: number | null) => (v == null ? "—" : int.format(v));
const pct = (v: number | null) =>
  v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
const mult = (v: number | null) =>
  v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×`;

const ddmm = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
};
function fmtCarimbo(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/** Métrica curta dentro do card (rótulo em cima, valor embaixo). */
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-sm font-semibold tabular-nums">{value}</span>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
    </div>
  );
}

const RANK_STYLE: Record<RankBucket, { txt: string; cls: string }> = {
  acima: { txt: "Acima", cls: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" },
  media: { txt: "Média", cls: "bg-muted text-muted-foreground" },
  abaixo: { txt: "Abaixo", cls: "bg-destructive/12 text-destructive" },
};

/** Pílula de ranking de qualidade da Meta (some quando "unknown"). */
function RankBadge({ label, bucket }: { label: string; bucket?: RankBucket }) {
  if (!bucket) return null;
  const s = RANK_STYLE[bucket];
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${s.cls}`}>
      {label} {s.txt}
    </span>
  );
}

/** Miniatura do criativo (ou placeholder). Só anúncios têm criativo. */
function Thumb({ p }: { p: MetaPerformer }) {
  if (p.thumbnailUrl)
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={p.thumbnailUrl}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        className="h-11 w-11 shrink-0 rounded-md border border-border object-cover"
      />
    );
  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border bg-muted">
      <IconPhotoOff className="h-4 w-4 text-muted-foreground" />
    </div>
  );
}

/** Card de uma campanha/anúncio — linka p/ o Gerenciador de Anúncios da Meta. */
function PerformerCard({ p, isAd }: { p: MetaPerformer; isAd: boolean }) {
  const temRanking = !!(p.quality || p.engagementRank || p.conversionRank);
  return (
    <a
      href={p.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group block h-full"
    >
      <div className="flex h-full flex-col gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-[var(--brand)]/50">
        <div className="flex items-start gap-2.5">
          {isAd ? <Thumb p={p} /> : null}
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="line-clamp-2 text-sm font-medium leading-snug" title={p.name}>
                {p.name}
              </p>
              <IconExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </div>
            {isAd && p.title ? (
              <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground" title={p.title}>
                {p.title}
              </p>
            ) : null}
          </div>
        </div>
        <p className="truncate text-[11px] text-muted-foreground">
          {p.brand}
          {isAd && p.campaign ? ` · ${p.campaign}` : ""}
        </p>
        {temRanking ? (
          <div className="flex flex-wrap gap-1">
            <RankBadge label="Qualidade" bucket={p.quality} />
            <RankBadge label="Engaj." bucket={p.engagementRank} />
            <RankBadge label="Conv." bucket={p.conversionRank} />
          </div>
        ) : null}
        <div className="flex items-baseline gap-1.5">
          <span className="text-xl font-semibold tabular-nums tracking-tight">
            {moneyC(p.spend)}
          </span>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">investido</span>
        </div>
        <div className="mt-auto grid grid-cols-3 gap-x-2 gap-y-2.5 border-t border-border pt-3">
          <Metric label="Leads" value={count(p.leads)} />
          <Metric label="CPL" value={money(p.cpl)} />
          <Metric label="ROAS" value={mult(p.roas)} />
          <Metric label="Conversas" value={count(p.conversations)} />
          <Metric label="R$/conversa" value={money(p.costPerConversation)} />
          <Metric label="CTR" value={pct(p.ctr)} />
        </div>
      </div>
    </a>
  );
}

/** Grade de cards (2 col no tablet, 3 no desktop) — reflui em vez de esticar. */
function PerformerGrid({
  linhas,
  vazio,
  isAd,
}: {
  linhas: MetaPerformer[];
  vazio: string;
  isAd: boolean;
}) {
  if (linhas.length === 0)
    return (
      <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
        {vazio}
      </p>
    );
  // Mostra ~2 linhas por padrão; o resto rola (scrollbar verde auto-hide global).
  // `pr-1` dá folga p/ a barrinha não encostar nos cards.
  return (
    <div className="max-h-[30rem] overflow-y-auto pr-1">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {linhas.map((p) => (
          <PerformerCard key={p.key} p={p} isAd={isAd} />
        ))}
      </div>
    </div>
  );
}

export function MetaDetailMetrics({ data }: { data: MetaDetail }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight">Meta Ads · detalhe ao vivo</h2>
          <p className="text-sm text-muted-foreground">
            {data.brand ? `${data.brand} · ` : "Todas as marcas · "}
            {ddmm(data.since)} a {ddmm(data.until)} · por campanha e anúncio
          </p>
        </div>
        <span className="text-[11px] text-muted-foreground">
          ao vivo · atualizado {fmtCarimbo(data.atualizadoEm)}
        </span>
      </div>

      {!data.hasData ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
          {data.erro
            ? `Não foi possível ler o detalhe ao vivo (${data.erro}). O overview acima segue válido.`
            : "Sem campanhas/anúncios com investimento no período."}
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold tracking-tight">Top campanhas por investimento</h3>
            <PerformerGrid
              linhas={data.campaigns}
              vazio="Nenhuma campanha com investimento no período."
              isAd={false}
            />
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold tracking-tight">Top anúncios por investimento</h3>
            <PerformerGrid
              linhas={data.ads}
              vazio="Nenhum anúncio com investimento no período."
              isAd
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            CPL = custo por lead · R$/conversa = custo por conversa iniciada no WhatsApp · ROAS =
            retorno sobre o investimento em vendas · badges de <strong>Qualidade/Engaj./Conv.</strong>{" "}
            = rankings da Meta vs. anúncios concorrentes (só aparecem com volume ≥ 500 impressões/7d) ·
            clique num card para abrir no Gerenciador de Anúncios.
          </p>
        </>
      )}
    </div>
  );
}
