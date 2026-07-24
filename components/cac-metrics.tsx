import { IconInfoCircle } from "@tabler/icons-react";

import type { CacResumo } from "@/lib/marketing/cac";

/**
 * Painel de CAC (Custo de Aquisição por Cliente) — Fase 1. Server component.
 * Gate no chamador: `marketing` E `financeiro`.
 *
 * Mostra o CAC consolidado (custo Marketing+Comercial ÷ vendas) e, por BU, o
 * custo RATEADO com a métrica-ponte "% sobre receita" — porque ainda não existe
 * nº de vendas por BU (ver docs/cac-plano.md).
 */
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brlC = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});
const int = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const money = (v: number | null) => (v == null ? "—" : brl.format(v));
const count = (v: number) => int.format(v);
const pct = (v: number | null) =>
  v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

const CHART_VARS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)"];

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
/** 'AAAA-MM' → 'jan'. */
function mesLabel(ym: string): string {
  const m = Number(ym.slice(5, 7));
  return MESES[(m - 1) % 12] ?? ym;
}

function Kpi({
  label,
  value,
  hint,
  highlight = false,
}: {
  label: string;
  value: string;
  hint?: string;
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
      {hint ? <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function CacMetrics({ data }: { data: CacResumo }) {
  const {
    ano,
    custoMarketing,
    custoComercial,
    custoTotal,
    centrosEncontrados,
    midiaPorMarca,
    midiaTotal,
    vendas,
    vendasFaturadas,
    vendasAFaturar,
    cac,
    serie,
    centros,
    custoDiretoTotal,
    custoCompartilhado,
    receitaTotal,
    porBu,
    temCustoDireto,
    driver,
  } = data;

  const maxMidia = Math.max(1, ...midiaPorMarca.map((m) => m.valor));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">CAC · custo de aquisição</h2>
        <p className="text-sm text-muted-foreground">
          Marketing + Comercial ÷ vendas · ano {ano} · vendas faturadas e a faturar
        </p>
      </div>

      {!centrosEncontrados ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
          Não encontrei os centros de custo <strong>Marketing</strong> e{" "}
          <strong>Comercial</strong> no Conta Azul deste ano. Sem eles não há como compor o custo
          de aquisição.
        </div>
      ) : (
        <>
          {/* Resultado principal */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Kpi
              label="CAC"
              value={money(cac)}
              hint={vendas > 0 ? `por venda` : "sem vendas no período"}
              highlight
            />
            <Kpi label="Custo total" value={money(custoTotal)} hint="Marketing + Comercial" />
            <Kpi label="Marketing" value={money(custoMarketing)} hint="centro de custo" />
            <Kpi label="Comercial" value={money(custoComercial)} hint="centro de custo" />
            <Kpi
              label="Vendas"
              value={count(vendas)}
              hint={`${count(vendasFaturadas)} faturadas + ${count(vendasAFaturar)} a faturar`}
            />
          </div>

          {/* Como o número é montado — transparência da fórmula */}
          <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/30 p-3">
            <IconInfoCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              <strong className="text-foreground">Como calculamos:</strong>{" "}
              {money(custoMarketing)} (Marketing) + {money(custoComercial)} (Comercial) ={" "}
              {money(custoTotal)} ÷ {count(vendas)} vendas = <strong>{money(cac)}</strong> por venda.
              O custo vem do <strong>Conta Azul</strong> (dinheiro efetivamente realizado) — o
              investimento do Meta Ads abaixo é <strong>composição</strong>, não soma, para não
              contar o mesmo dinheiro duas vezes.
            </p>
          </div>

          {/* Série mensal do CAC */}
          {serie.length ? (
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold tracking-tight">CAC por mês</h3>
                <span className="text-[11px] text-muted-foreground">
                  custo do mês ÷ vendas do mês
                </span>
              </div>
              <div className="overflow-x-auto">
                <div className="flex min-w-[520px] items-end gap-1.5" style={{ height: 140 }}>
                  {serie.map((m) => {
                    const maxCac = Math.max(1, ...serie.map((x) => x.cac ?? 0));
                    const h = m.cac ? Math.max(3, (m.cac / maxCac) * 100) : 3;
                    return (
                      <div key={m.mes} className="flex flex-1 flex-col items-center gap-1">
                        <div className="flex w-full flex-1 items-end">
                          <div
                            className="w-full rounded-t bg-[var(--brand)]"
                            style={{ height: `${h}%`, opacity: m.cac ? 1 : 0.25 }}
                            title={`${mesLabel(m.mes)} · CAC ${money(m.cac)} · ${count(m.vendas)} vendas · custo ${money(m.custo)}`}
                          />
                        </div>
                        <span className="text-[10px] text-muted-foreground">
                          {mesLabel(m.mes)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Passe o mouse para ver custo, vendas e CAC de cada mês. Meses sem venda ficam
                esmaecidos (CAC indefinido).
              </p>
            </div>
          ) : null}

          {/* Centros que compõem o custo */}
          {centros.length ? (
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold tracking-tight">
                  Centros de custo considerados
                </h3>
                <span className="text-[11px] text-muted-foreground">
                  {money(custoDiretoTotal)} com BU no nome · {money(custoCompartilhado)} compartilhado
                </span>
              </div>
              <ul className="flex flex-col divide-y divide-border">
                {centros.map((c) => (
                  <li key={c.centro} className="flex items-center gap-2 py-2 text-sm">
                    <span className="flex-1 truncate">{c.centro}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {c.tipo}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] ${
                        c.bu
                          ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {c.bu ?? "compartilhado"}
                    </span>
                    <span className="w-24 shrink-0 text-right tabular-nums">
                      {brlC.format(c.valor)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Mídia por marca */}
          {midiaPorMarca.length ? (
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold tracking-tight">
                  Investimento de mídia por marca
                </h3>
                <span className="text-[11px] text-muted-foreground">
                  {money(midiaTotal)} no Meta Ads · já contido no centro Marketing
                </span>
              </div>
              <ul className="flex flex-col gap-3">
                {midiaPorMarca.map((m, i) => (
                  <li key={m.marca} className="flex flex-col gap-1">
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="text-muted-foreground">
                        {m.marca} <span className="text-xs">→ {m.bu}</span>
                      </span>
                      <span className="font-medium tabular-nums">{brlC.format(m.valor)}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${(m.valor / maxMidia) * 100}%`,
                          background: CHART_VARS[i % CHART_VARS.length],
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Por BU — ponte enquanto não há vendas por BU */}
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold tracking-tight">Por unidade (BU)</h3>
              <span className="text-[11px] text-muted-foreground">
                rateio por {driver === "midia" ? "investimento de mídia" : "receita"}
              </span>
            </div>

            <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
              <IconInfoCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-xs text-amber-800 dark:text-amber-300">
                <strong>Ainda não é CAC em R$ por BU.</strong> O Conta Azul não informa a BU da
                venda, então não há <em>número de vendas por unidade</em>. Enquanto isso, mostramos
                o custo alocado e o <strong>% sobre a receita</strong> da BU.
                {!temCustoDireto ? (
                  <>
                    {" "}
                    Todo o custo está sendo <strong>rateado</strong> (nenhuma despesa tem BU própria
                    ainda — as 93 categorias de despesa estão sem BU).
                  </>
                ) : null}{" "}
                Ver <code>docs/cac-plano.md</code>.
              </p>
            </div>

            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Unidade</th>
                    <th className="px-4 py-3 text-right font-medium">Receita</th>
                    <th className="px-4 py-3 text-right font-medium">Participação</th>
                    <th className="px-4 py-3 text-right font-medium">Custo direto</th>
                    <th className="px-4 py-3 text-right font-medium">Custo rateado</th>
                    <th className="px-4 py-3 text-right font-medium">Custo total</th>
                    <th className="px-4 py-3 text-right font-medium">% da receita</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {porBu.map((b) => (
                    <tr key={b.bu} className="border-b border-border last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-3 font-medium text-foreground">{b.bu}</td>
                      <td className="px-4 py-3 text-right">{brlC.format(b.receita)}</td>
                      <td className="px-4 py-3 text-right">{pct(b.share * 100)}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">
                        {b.custoDireto > 0 ? brlC.format(b.custoDireto) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">{brlC.format(b.custoRateado)}</td>
                      <td className="px-4 py-3 text-right font-medium">
                        {brlC.format(b.custoTotal)}
                      </td>
                      <td className="px-4 py-3 text-right">{pct(b.pctSobreReceita)}</td>
                    </tr>
                  ))}
                  {porBu.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-xs text-muted-foreground">
                        Sem receita por unidade no período.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Receita total do ano: {money(receitaTotal)}. O rateio distribui o custo compartilhado
              proporcionalmente — <strong>quem fatura mais absorve mais custo</strong>, então
              compare sempre o &quot;% da receita&quot;, não o custo absoluto.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
