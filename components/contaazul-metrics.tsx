import Link from "next/link";

import { InteractiveBarsChart } from "@/components/charts/interactive-bars";
import { InteractiveDonutRing } from "@/components/charts/interactive-donut";
import type {
  CaRangeKey,
  CategoriaValor,
  ContaAzulDashboard,
  DreLinha,
} from "@/lib/contaazul/dashboard";

/**
 * Painel financeiro (Conta Azul). Server component: o filtro de período navega
 * por searchParam `ca` via <Link> e o server re-consulta `getContaAzulDashboard`.
 * Gráficos (fluxo mensal, donuts de categoria, DRE cascata) são SVG/CSS a partir
 * de dados reais. Sem estado de cliente. Cores: verde da marca + tons de apoio.
 */

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brlCompact = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});
const money = (v: number | null) => (v == null ? "—" : brl.format(v));

const MES_ABREV = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];
const mesLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return `${MES_ABREV[(m - 1) % 12]}/${String(y).slice(2)}`;
};
const ddmmyyyy = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

const CHART_VARS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--muted-foreground)",
];

const RANGE_LABELS: { key: CaRangeKey; label: string }[] = [
  { key: "mes", label: "Mês atual" },
  { key: "3m", label: "3 meses" },
  { key: "6m", label: "6 meses" },
  { key: "ano", label: "Ano" },
];

/** Href do dashboard preservando os demais params, trocando só `ca`. */
function buildHref(
  current: Record<string, string | undefined>,
  ca: CaRangeKey,
): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    if (v && k !== "ca") p.set(k, v);
  }
  if (ca !== "6m") p.set("ca", ca);
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
          ? "border-transparent bg-foreground text-background"
          : "border-border text-muted-foreground hover:bg-muted/60"
      }`}
    >
      {children}
    </Link>
  );
}

function Kpi({
  label,
  value,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "bad" | "brand";
  hint?: string;
}) {
  const valueCls =
    tone === "good"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "bad"
        ? "text-red-600 dark:text-red-400"
        : "text-foreground";
  return (
    <div
      className={`flex flex-col rounded-xl border border-border p-4 ${
        tone === "brand" ? "bg-[var(--brand)]/10" : "bg-card"
      }`}
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums tracking-tight ${valueCls}`}>
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Donut (conic-gradient) de composição por categoria. */
function CategoriaDonut({
  itens,
  centerLabel,
}: {
  itens: CategoriaValor[];
  centerLabel: string;
}) {
  const total = itens.reduce((s, c) => s + c.valor, 0);
  const legend = itens.map((c, i) => ({
    ...c,
    color: CHART_VARS[i % CHART_VARS.length],
  }));

  if (!itens.length) {
    return <p className="text-sm text-muted-foreground">Sem dados no período.</p>;
  }

  return (
    <div className="flex items-center gap-5">
      <InteractiveDonutRing
        items={legend.map((l) => ({
          label: l.nome,
          value: l.valor,
          color: l.color,
        }))}
      >
        <div>
          <p className="text-[11px] font-semibold tabular-nums leading-tight">
            {brlCompact.format(total)}
          </p>
          <p className="mt-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
            {centerLabel}
          </p>
        </div>
      </InteractiveDonutRing>
      <ul className="flex flex-col gap-1.5 text-sm">
        {legend.map((l) => (
          <li key={l.nome} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 flex-none rounded-sm"
              style={{ background: l.color }} />
            <span className="max-w-[150px] truncate text-muted-foreground">
              {l.nome}
            </span>
            <span className="ml-auto tabular-nums font-medium">
              {brlCompact.format(l.valor)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** DRE em cascata: receita no topo, despesas descontando, resultado no fim. */
function DreCascata({ linhas }: { linhas: DreLinha[] }) {
  const max = Math.max(1, ...linhas.map((l) => Math.abs(l.valor)));
  return (
    <ul className="flex flex-col gap-2">
      {linhas.map((l) => {
        const w = (Math.abs(l.valor) / max) * 100;
        const cor =
          l.tipo === "receita"
            ? "var(--brand)"
            : l.tipo === "resultado"
              ? l.valor >= 0
                ? "var(--brand)"
                : "var(--chart-4)"
              : "var(--chart-4)";
        return (
          <li key={l.label} className="flex items-center gap-3">
            <span className="w-32 flex-none truncate text-sm text-muted-foreground">
              {l.label}
            </span>
            <span className="relative h-5 flex-1 overflow-hidden rounded bg-muted/40">
              <span
                className="absolute inset-y-0 left-0 rounded"
                style={{
                  width: `${w}%`,
                  background: cor,
                  opacity: l.tipo === "despesa" ? 0.8 : 1,
                }}
              />
            </span>
            <span
              className={`w-28 flex-none text-right text-sm font-semibold tabular-nums ${
                l.valor < 0
                  ? "text-red-600 dark:text-red-400"
                  : l.tipo === "resultado"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-foreground"
              }`}
            >
              {money(l.valor)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function ContaAzulMetrics({
  data,
  currentParams,
}: {
  data: ContaAzulDashboard;
  currentParams: Record<string, string | undefined>;
}) {
  const { kpis, range, since, until } = data;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">
          Conta Azul · financeiro
        </h2>
        <p className="text-sm text-muted-foreground">
          Vencimentos de {ddmmyyyy(since)} a {ddmmyyyy(until)}
          {data.lastSyncedAt ? " · atualizado agora" : ""}
        </p>
      </div>

      {/* Filtro de período */}
      <div className="flex flex-wrap items-center gap-2">
        {RANGE_LABELS.map(({ key, label }) => (
          <Chip key={key} href={buildHref(currentParams, key)} active={range === key}>
            {label}
          </Chip>
        ))}
      </div>

      {!data.connected ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
          {data.notice ??
            "Conecte a Conta Azul em Configurações → Conexões para ver o financeiro."}
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <Kpi label="Receita recebida" value={money(kpis.receitaRecebida)}
              tone="good" hint={`A receber: ${brlCompact.format(kpis.receitaAberta)}`} />
            <Kpi label="Despesa paga" value={money(kpis.despesaPaga)}
              tone="bad" hint={`A pagar: ${brlCompact.format(kpis.despesaAberta)}`} />
            <Kpi label="Resultado (caixa)" value={money(kpis.resultado)}
              tone={kpis.resultado >= 0 ? "good" : "bad"} />
            <Kpi label="Saldo previsto" value={money(kpis.saldoPrevisto)}
              tone="brand" hint="Recebido+aberto − pago+aberto" />
            <Kpi label="A receber vencido" value={money(kpis.receitaVencida)}
              tone={kpis.receitaVencida > 0 ? "bad" : "neutral"} />
            <Kpi label="A pagar vencido" value={money(kpis.despesaVencida)}
              tone={kpis.despesaVencida > 0 ? "bad" : "neutral"} />
            {data.vendasAprovadas != null ? (
              <Kpi label="Vendas aprovadas" value={money(data.vendasAprovadas)}
                hint="Amostra recente" />
            ) : null}
          </div>

          {/* Fluxo de caixa + DRE */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-semibold tracking-tight">
                  Fluxo de caixa mensal
                </h3>
                <div className="flex gap-4 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm" style={{ background: "var(--brand)" }} />
                    Recebido
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm" style={{ background: "var(--chart-4)" }} />
                    Pago
                  </span>
                </div>
              </div>
              {data.fluxo.length ? (
                <InteractiveBarsChart
                  groups={data.fluxo.map((p) => ({
                    label: mesLabel(p.month),
                    values: { receita: p.receita, despesa: p.despesa },
                  }))}
                  bars={[
                    { key: "receita", color: "var(--brand)", label: "Recebido" },
                    { key: "despesa", color: "var(--chart-4)", label: "Pago" },
                  ]}
                  ariaLabel="Fluxo de caixa mensal: recebido vs. pago"
                />
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Sem movimentação no período.
                </p>
              )}
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="mb-4 text-sm font-semibold tracking-tight">
                DRE (resultado do período)
              </h3>
              {data.dre.length ? (
                <DreCascata linhas={data.dre} />
              ) : (
                <p className="text-sm text-muted-foreground">Sem dados.</p>
              )}
            </div>
          </div>

          {/* Composição por categoria */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="mb-4 text-sm font-semibold tracking-tight">
                Receita por categoria
              </h3>
              <CategoriaDonut itens={data.receitaPorCategoria} centerLabel="Receita" />
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="mb-4 text-sm font-semibold tracking-tight">
                Despesa por categoria
              </h3>
              <CategoriaDonut itens={data.despesaPorCategoria} centerLabel="Despesa" />
            </div>
          </div>

          {data.topClientes.length ? (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Cliente</th>
                    <th className="px-4 py-3 text-right font-medium">Vendas</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {data.topClientes.map((c) => (
                    <tr key={c.nome}
                      className="border-b border-border last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-3 font-medium text-foreground">{c.nome}</td>
                      <td className="px-4 py-3 text-right">{money(c.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
