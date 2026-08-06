import { IconInfoCircle } from "@tabler/icons-react";

import { CacControles } from "@/components/cac-controles";
import { CacSerieChart } from "@/components/cac-serie-chart";
import { CORTE_BANCO_PROPRIO, type CacResumo } from "@/lib/marketing/cac";
import { cacMesCorrente } from "@/lib/marketing/cac-opcoes";

/**
 * Painel de CAC (Custo de Aquisição por Cliente). Server component.
 * Gate no chamador: `marketing` — só isso desde 2026-08-05.
 *
 * Mostra o CAC do MÊS escolhido nos dois regimes (previsto e realizado, cada um
 * com o seu denominador) e a tendência dos 12 meses até ele.
 *
 * NÃO mostra receita por unidade, rateio nem "% sobre receita": isso é
 * controladoria, e era o que obrigava a exigir também a permissão `financeiro`.
 * Ver `docs/cac-fontes.md`.
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

const CHART_VARS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)"];

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
/** 'AAAA-MM' → 'jan'. */
function mesLabel(ym: string): string {
  const m = Number(ym.slice(5, 7));
  return MESES[(m - 1) % 12] ?? ym;
}

/** 'AAAA-MM' → 'ago/2026'. Usado no cabeçalho, onde o ano importa. */
function mesAno(ym: string): string {
  return `${mesLabel(ym)}/${ym.slice(0, 4)}`;
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

export function CacMetrics({ data, mes }: { data: CacResumo; mes: string }) {
  const {
    periodo,
    fontes,
    custoPrevisto,
    custoRealizado,
    cacPrevisto,
    cacRealizado,
    custoMarketing,
    custoComercial,
    custoTotal,
    centrosEncontrados,
    midiaPorMarca,
    midiaTotal,
    vendas,
    vendasFaturadas,
    vendasAFaturar,
    serie,
  } = data;

  const maxMidia = Math.max(1, ...midiaPorMarca.map((m) => m.valor));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight">CAC · custo de aquisição</h2>
          <p className="text-sm text-muted-foreground">
            Marketing + Comercial ÷ vendas · {mesAno(periodo.ate)} · vendas faturadas e a
            faturar
          </p>
        </div>
        <CacControles mes={mes} />
      </div>

      {!centrosEncontrados ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
          Não encontrei custo de <strong>Marketing</strong> ou <strong>Comercial</strong> neste
          período — nem no Conta Azul (até jul/2026) nem no banco próprio (de ago/2026 em
          diante). Sem custo não há como compor o CAC.
        </div>
      ) : (
        <>
          {/* Os dois regimes lado a lado, cada um com o SEU denominador. O valor
              grande é sempre R$ por venda; o apoio mostra a divisão que o gerou,
              senão o cartão exibia um unitário em cima e um total embaixo, ambos
              em reais e sem rótulo. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Kpi
              label="CAC previsto · por venda"
              value={money(cacPrevisto)}
              hint={`${money(custoPrevisto)} lançados ÷ ${count(vendas)} vendas`}
              highlight
            />
            <Kpi
              label="CAC realizado · por venda"
              value={money(cacRealizado)}
              hint={`${money(custoRealizado)} pagos ÷ ${count(vendasFaturadas)} faturadas`}
            />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label="Custo total" value={money(custoTotal)} hint="Marketing + Comercial" />
            <Kpi label="Marketing" value={money(custoMarketing)} hint="lançado no período" />
            <Kpi label="Comercial" value={money(custoComercial)} hint="lançado no período" />
            <Kpi
              label="Vendas"
              value={count(vendas)}
              hint={`${count(vendasFaturadas)} faturadas + ${count(vendasAFaturar)} a faturar`}
            />
          </div>

          {/* Não há mais aviso de "mês pela metade" nem de "realizado zerado".
              Com cada regime usando o próprio denominador, um mês recém-começado
              produz realizado baixo dos DOIS lados — que é a resposta certa, não
              uma distorção a explicar. O previsto segue cobrindo o mês inteiro,
              e é isso que ele deve fazer: é o planejado. */}

          {/* O corte de fonte é a coisa mais fácil de esquecer aqui — deixar
              visível evita que alguém compare períodos sem saber que a origem
              do custo mudou no meio. */}
          {fontes.contaAzul > 0 && fontes.bancoProprio > 0 ? (
            <p className="text-[11px] text-muted-foreground">
              Custo deste período vem de duas fontes: {money(fontes.contaAzul)} do Conta Azul
              (até {mesAno("2026-07")}) e {money(fontes.bancoProprio)} do banco próprio (de{" "}
              {mesAno(CORTE_BANCO_PROPRIO)} em diante). Nenhum mês soma as duas.
            </p>
          ) : null}

          {/* Como o número é montado — transparência da fórmula */}
          <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/30 p-3">
            <IconInfoCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              <strong className="text-foreground">Como calculamos:</strong>{" "}
              {money(custoMarketing)} (Marketing) + {money(custoComercial)} (Comercial) ={" "}
              {money(custoTotal)} ÷ {count(vendas)} vendas = <strong>{money(cacPrevisto)}</strong>{" "}
              por venda no <strong>previsto</strong>.{" "}
              <strong className="text-foreground">Os dois regimes andam juntos:</strong> o previsto
              divide o custo lançado por todas as vendas; o realizado divide o custo{" "}
              <strong>pago</strong> pelas vendas já <strong>faturadas</strong>. Num mês recém
              começado os dois ficam baixos, que é a leitura certa.{" "}
              A fonte do custo é o <strong>Conta Azul até jul/2026</strong> e o{" "}
              <strong>banco próprio de ago/2026</strong> em diante, nunca as duas no mesmo mês. O
              investimento do Meta Ads abaixo é <strong>composição</strong>, não soma, para não
              contar o mesmo dinheiro duas vezes.
            </p>
          </div>

          {/* Série mensal do CAC */}
          {serie.length ? (
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold tracking-tight">CAC por mês</h3>
                {/* O gráfico NÃO se limita ao mês escolhido — mostra a janela até
                    ele, senão seria uma barra só. Dizer o intervalo evita a
                    leitura de que os números do topo cobrem tudo isto. */}
                <span className="text-[11px] text-muted-foreground">
                  previsto · por venda ·{" "}
                  {serie.length > 1
                    ? `${mesAno(serie[0].mes)} a ${mesAno(serie[serie.length - 1].mes)}`
                    : mesAno(periodo.ate)}
                </span>
              </div>
              <CacSerieChart serie={serie} mesEmCurso={cacMesCorrente()} />

              <p className="mt-2 text-[11px] text-muted-foreground">
                Passe o mouse para ver previsto e realizado de cada mês. Meses sem venda ficam
                esmaecidos; o mês em curso aparece listrado — o custo previsto já cobre o mês
                inteiro enquanto as vendas só existem até hoje, então ele fica inflado e fora
                da escala.
              </p>
            </div>
          ) : (
            // Auto-diagnóstico: em vez de sumir, explica POR QUE a série está vazia.
            <div className="rounded-xl border border-dashed border-border p-4">
              <h3 className="mb-1 text-sm font-semibold tracking-tight">CAC por mês</h3>
              <p className="text-xs text-muted-foreground">
                Sem série mensal para exibir.{" "}
                {vendas === 0
                  ? "O Conta Azul não retornou vendas neste ano — sem denominador para o CAC mensal."
                  : custoTotal === 0
                    ? "Sem custo de Marketing/Comercial por mês (o Conta Azul não trouxe o detalhamento mensal dos centros)."
                    : "O detalhamento mensal do Conta Azul não veio neste carregamento (o CA pode ter demorado) — clique em Atualizar."}{" "}
                <span className="tabular-nums">
                  (ano: {count(vendas)} vendas · custo {money(custoTotal)})
                </span>
              </p>
            </div>
          )}

          {/* SAIU: lista "Centros de custo considerados" (2026-08-05).
              Mostrava cada centro com valor e o split entre custo direto e
              compartilhado — detalhe de controladoria dentro do Marketing. O
              agregado Marketing/Comercial acima já responde o que este setor
              precisa. Os dados seguem em `data.centros` para quem quiser montar
              a visão no Financeiro. */}

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
                  <li
                    key={m.marca}
                    className="flex flex-col gap-1"
                    // O valor visível é compacto ("R$ 13,3 mil") para caber na
                    // linha; o exato e a participação ficam aqui, ao alcance do
                    // mouse, sem gastar espaço nem virar um gráfico interativo
                    // para quatro barras.
                    title={`${m.marca} · ${money(m.valor)} · ${
                      midiaTotal > 0 ? ((m.valor / midiaTotal) * 100).toFixed(1) : "0"
                    }% do investimento de mídia · unidade ${m.bu}`}
                  >
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

          {/* SAIU: tabela "Por unidade (BU)" (2026-08-05).
              Expunha RECEITA por unidade, participação no rateio, custo alocado e
              "% sobre a receita" — faturamento da empresa vazando para dentro do
              Marketing, e a razão de a aba exigir também a permissão `financeiro`.
              Removida, o CAC passou a exigir só `marketing`.

              O cálculo continua em `getCac(..., { incluirBu: true })`, opt-in
              porque custa uma varredura paginada de `fin_receita_snapshot`. É de
              lá que sai um futuro painel no Financeiro. Ver docs/cac-fontes.md. */}
        </>
      )}
    </div>
  );
}
