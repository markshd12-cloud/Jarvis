import type { InstagramFunnel } from "@/lib/marketing/instagram-funnel";

/**
 * Funil orgânico do Instagram (Fase 1): alcance → engajaram → visitaram o perfil
 * → clicaram no link da bio (tráfego IG→site), com as taxas de conversão entre
 * etapas. Server component; dados ao vivo (cache 10 min) de `getInstagramFunnel`.
 * Só aparece no /marketing.
 */
const int = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const count = (v: number) => int.format(v);
const pct = (v: number | null) =>
  v == null ? "—" : `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

const ddmm = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
};

interface Stage {
  label: string;
  value: number;
  /** Conversão vs. etapa de referência (texto pronto). */
  conv?: string;
}

export function InstagramFunnelPanel({ data }: { data: InstagramFunnel }) {
  if (!data.hasData) return null;

  const stages: Stage[] = [
    { label: "Alcance (contas)", value: data.reach },
    { label: "Engajaram", value: data.accountsEngaged, conv: `${pct(data.engajamentoRate)} do alcance` },
    { label: "Visitaram o perfil", value: data.profileViews, conv: `${pct(data.perfilRate)} do alcance` },
    { label: "Clicaram no link da bio", value: data.websiteClicks, conv: `${pct(data.cliqueRate)} do perfil` },
  ];
  const max = Math.max(1, ...stages.map((s) => s.value));

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-tight">
          Funil orgânico
          <span className="ml-2 font-normal text-muted-foreground">
            {ddmm(data.since)} a {ddmm(data.until)}
          </span>
        </h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          {count(data.views)} impressões · {count(data.totalInteractions)} interações
        </span>
      </div>

      <div className="flex flex-col gap-2.5">
        {stages.map((s, i) => (
          <div key={s.label} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="text-muted-foreground">{s.label}</span>
              <span className="tabular-nums font-medium">
                {count(s.value)}
                {s.conv ? (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">{s.conv}</span>
                ) : null}
              </span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(2, (s.value / max) * 100)}%`,
                  // Verde da marca no topo, esmaecendo conforme afunila.
                  background: `color-mix(in oklch, var(--brand) ${100 - i * 18}%, var(--muted-foreground))`,
                }}
              />
            </div>
          </div>
        ))}
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground">
        Cliques no link da bio = tráfego orgânico do Instagram para o site. Casa com as sessões de
        origem <em>Instagram</em> no GA4.
      </p>
    </div>
  );
}
