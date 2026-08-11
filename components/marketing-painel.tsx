"use client";

/**
 * PAINEL do Marketing — a tela de abertura do módulo.
 *
 * Leitura em três alturas, e a ordem dos blocos existe por isso:
 *   ~5s   está bom ou ruim?      → faixa de saúde + os 4 números
 *   ~30s  o que precisa de mim?  → alertas + semáforo de metas
 *   ~2min por quê?               → marcas, tendência, funis
 *
 * Do que exige ação para o que dá contexto. Quem tem dez segundos lê o topo e
 * vai embora com o essencial.
 *
 * ⚠️ `div`, nunca `section`: neste repo `section` é camada estrutural de página
 * com `min-h-full` (globals.css) e esticaria cada bloco numa tarja gigante.
 */
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  IconAlertTriangle,
  IconArrowDownRight,
  IconArrowUpRight,
  IconChevronLeft,
  IconChevronRight,
  IconMinus,
} from "@tabler/icons-react";

import { InteractiveLineChart } from "@/components/charts/interactive-line";
import { brl, brlCompact, int } from "@/components/charts/format";
import { cn } from "@/lib/utils";
import type {
  Alerta,
  FonteSaude,
  FunilCanal,
  NumeroDoMes,
  PainelResumo,
} from "@/lib/marketing/painel";

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

// ---------------------------- 1 · saúde das fontes -------------------------- //

const COR_ESTADO: Record<FonteSaude["estado"], string> = {
  ok: "bg-emerald-500",
  atraso: "bg-amber-500",
  parado: "bg-red-500",
  desconhecido: "bg-muted-foreground/40",
};

/**
 * A faixa mais importante do Painel, e a que não estava na proposta original.
 *
 * Painel consolidado é exatamente onde uma fonte quebrada passa despercebida: o
 * leitor vê blocos com números bonitos e não tem como saber que um deles está
 * congelado. O GA4 ficou parado duas semanas sem ninguém notar — isto é o que
 * teria avisado no dia seguinte.
 */
function FaixaSaude({ fontes }: { fontes: FonteSaude[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-card px-4 py-2.5">
      {fontes.map((f) => (
        <span key={f.nome} className="flex items-center gap-2 text-xs">
          <span className={cn("size-2 shrink-0 rounded-full", COR_ESTADO[f.estado])} />
          <span className="font-medium">{f.nome}</span>
          <span
            className={cn(
              "text-muted-foreground",
              f.estado === "parado" && "text-red-500 dark:text-red-400",
            )}
          >
            {f.detalhe}
          </span>
        </span>
      ))}
    </div>
  );
}

// ------------------------------ 2 · linha do mês ---------------------------- //

/**
 * Delta contra o mês anterior.
 *
 * A cor sai de `menorEhMelhor`, não do sinal: custo por resultado caindo é
 * VERDE, embora o número seja negativo. Sem isso o leitor precisa lembrar a
 * direção de cada card antes de saber se a cor é boa — a mesma convenção do DRE
 * e da aba de Metas.
 */
function Delta({ n }: { n: NumeroDoMes }) {
  if (n.variacao == null)
    return <span className="text-[11px] text-muted-foreground">sem base anterior</span>;

  const subiu = n.variacao > 0;
  const bom = n.menorEhMelhor ? !subiu : subiu;
  const neutro = Math.abs(n.variacao) < 0.005;
  const Icone = neutro ? IconMinus : subiu ? IconArrowUpRight : IconArrowDownRight;

  return (
    <span
      className={cn(
        "flex items-center gap-0.5 text-[11px] font-medium tabular-nums",
        neutro
          ? "text-muted-foreground"
          : bom
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-red-500 dark:text-red-400",
      )}
    >
      <Icone className="size-3" />
      {Math.abs(Math.round(n.variacao * 100))}% vs mês anterior
    </span>
  );
}

function CardNumero({
  titulo,
  n,
  formato,
  sufixo,
}: {
  titulo: string;
  n: NumeroDoMes;
  formato: (v: number) => string;
  sufixo?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {titulo}
      </span>
      <span className="text-2xl font-semibold tabular-nums">
        {/* Ausência ≠ zero: fonte sem dado mostra travessão, não "0". */}
        {n.valor == null ? "—" : formato(n.valor)}
        {n.valor != null && sufixo ? (
          <span className="ml-1 text-sm font-normal text-muted-foreground">{sufixo}</span>
        ) : null}
      </span>
      <Delta n={n} />
    </div>
  );
}

// -------------------------------- 3 · alertas ------------------------------- //

/**
 * Sem alerta, o bloco não renderiza — nem como "tudo certo ✅".
 * Um selo verde toda rodada treina as pessoas a pular a região, e aí o alerta
 * de verdade passa junto.
 */
function BlocoAlertas({ alertas }: { alertas: Alerta[] }) {
  if (alertas.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold tracking-tight">
        Precisa de atenção
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          {alertas.length}
        </span>
      </h3>
      <ul className="flex flex-col gap-2">
        {alertas.map((a, i) => {
          const critico = a.nivel === "critico";
          const corpo = (
            <div
              className={cn(
                "flex items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors",
                critico
                  ? "border-red-500/30 bg-red-500/10"
                  : "border-amber-500/30 bg-amber-500/10",
                a.aba && "hover:brightness-105",
              )}
            >
              <IconAlertTriangle
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  critico
                    ? "text-red-500 dark:text-red-400"
                    : "text-amber-600 dark:text-amber-400",
                )}
              />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-medium">{a.titulo}</span>
                <span className="text-xs text-muted-foreground">{a.detalhe}</span>
              </div>
            </div>
          );
          return (
            <li key={`${a.titulo}-${i}`}>
              {/* Cada alerta leva à aba que detalha o problema. */}
              {a.aba ? <Link href={`/marketing?aba=${a.aba}`}>{corpo}</Link> : corpo}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------- 4 · semáforo de metas ------------------------- //

function BlocoMetas({ metas }: { metas: PainelResumo["metas"] }) {
  const semMeta = metas.total - metas.definidas;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-tight">Metas do mês</h3>
        <Link
          href="/marketing?aba=metas"
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          {/* Cobertura à vista: sem isto o bloco fingiria cobrir tudo quando
              cobre 3 de 11. */}
          {metas.definidas} de {metas.total} definidas · {metas.dentro} dentro ·{" "}
          {metas.fora} fora
        </Link>
      </div>

      {metas.piores.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          {semMeta === metas.total
            ? "Nenhuma meta cadastrada ainda — sem meta, o Painel informa mas não cobra."
            : "Metas cadastradas ainda sem base para comparar no período."}
        </p>
      ) : (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border bg-card">
          {metas.piores.map((m) => {
            const rel = m.desvio != null && m.valor ? m.desvio / Math.abs(m.valor) : null;
            const bom = (m.desvio ?? 0) >= 0;
            return (
              <li
                key={`${m.metrica}|${m.alvo}`}
                className="flex items-center justify-between gap-3 px-4 py-2.5"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm">{m.rotulo}</span>
                  <span className="truncate text-[11px] text-muted-foreground">
                    {m.detalhe}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-3 tabular-nums">
                  <span className="text-right text-xs text-muted-foreground">
                    meta{" "}
                    {m.unidade === "brl" ? brl.format(m.valor ?? 0) : int.format(m.valor ?? 0)}
                    <br />
                    atual{" "}
                    {m.unidade === "brl"
                      ? brl.format(m.atual ?? 0)
                      : int.format(m.atual ?? 0)}
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-medium",
                      bom
                        ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"
                        : "bg-red-500/12 text-red-500 dark:text-red-400",
                    )}
                  >
                    {rel == null
                      ? "—"
                      : `${rel > 0 ? "+" : ""}${Math.round(rel * 100)}%`}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// --------------------------- 5 · distribuição por marca --------------------- //

const CORES = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function BlocoMarcas({ marcas }: { marcas: PainelResumo["marcas"] }) {
  if (marcas.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold tracking-tight">Para onde foi o investimento</h3>
      <ul className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        {marcas.map((m, i) => (
          <li key={m.brand} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate">{m.brand}</span>
              <span className="shrink-0 font-medium tabular-nums">
                {brl.format(m.spend)}
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  {Math.round(m.fatia * 100)}%
                </span>
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(m.fatia * 100, 1)}%`,
                  background: CORES[i % CORES.length],
                }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums">
              <span>{int.format(m.resultados)} resultados</span>
              <span>
                {m.custoResultado == null
                  ? "sem resultado"
                  : `${brl.format(m.custoResultado)} cada`}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------ 6 · tendência ------------------------------- //

/**
 * Os cinco blocos da proposta original respondiam "como estamos". Nenhum
 * respondia "para onde estamos indo" — que é a pergunta que muda orçamento.
 * Noventa dias distinguem "o custo está alto" de "o custo vem subindo há seis
 * semanas": conversas diferentes.
 */
function BlocoTendencia({ pontos }: { pontos: PainelResumo["tendencia"] }) {
  if (pontos.length < 2) return null;

  // Resumo do período, para o gráfico não exigir leitura pixel a pixel.
  const totalGasto = pontos.reduce((s, p) => s + p.spend, 0);
  const totalRes = pontos.reduce((s, p) => s + p.resultados, 0);
  const comCusto = pontos.filter((p) => p.custoResultado != null);
  const primeiro = comCusto[0]?.custoResultado ?? null;
  const ultimo = comCusto[comCusto.length - 1]?.custoResultado ?? null;
  const tendenciaCusto =
    primeiro && ultimo ? (ultimo - primeiro) / primeiro : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-tight">Últimos 90 dias</h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          {brl.format(totalGasto)} · {int.format(totalRes)} resultados
          {tendenciaCusto != null ? (
            <>
              {" · custo "}
              <span
                className={cn(
                  "font-medium",
                  tendenciaCusto > 0
                    ? "text-red-500 dark:text-red-400"
                    : "text-emerald-600 dark:text-emerald-400",
                )}
              >
                {tendenciaCusto > 0 ? "▲" : "▼"}
                {Math.abs(Math.round(tendenciaCusto * 100))}% no período
              </span>
            </>
          ) : null}
        </span>
      </div>
      <div className="rounded-xl border border-border bg-card p-4">
        <InteractiveLineChart
          ariaLabel="Investimento, resultados e custo por resultado nos últimos 90 dias"
          legend
          points={pontos.map((p) => ({
            label: ddmm(p.date),
            values: {
              spend: p.spend,
              resultados: p.resultados,
              custo: p.custoResultado ?? 0,
            },
          }))}
          /**
           * Três recursos para separar as séries, não só cor: a paleta do repo é
           * monocromática (todas em hue 142.5), então `--chart-1` e `--chart-2`
           * são dois verdes quase iguais — era isso que embaralhava o gráfico.
           *
           *   área sólida  → investimento
           *   tracejada    → resultados          (mesma convenção do Meta Ads)
           *   linha cheia  → custo por resultado (a métrica que decide)
           *
           * Cada série tem escala própria (eixos-y implícitos), senão o gasto em
           * milhares achataria os resultados em dezenas contra o eixo.
           */
          series={[
            {
              key: "spend",
              label: "Investimento",
              color: "var(--chart-1)",
              area: true,
              format: "brl", // sem isto o tooltip mostrava "6070", não "R$ 6.070,00"
            },
            {
              key: "resultados",
              label: "Resultados",
              color: "var(--chart-3)",
              dashed: true,
              format: "int",
            },
            {
              key: "custo",
              label: "Custo/resultado (méd. 7d)",
              color: "var(--chart-5)",
              format: "brl",
            },
          ]}
        />
      </div>
    </div>
  );
}

// -------------------------------- 7 · funis --------------------------------- //

/**
 * Quatro funis em PARALELO, comparáveis pela forma e nunca pelo total: "alcance"
 * do Instagram e "impressões" do Meta não são a mesma unidade, e empilhá-las
 * produziria um número que não existe.
 */
function BlocoFunis({ funis }: { funis: FunilCanal[] }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold tracking-tight">Funis por canal</h3>
      <p className="text-[11px] text-muted-foreground">
        Comparáveis pela forma, não pelo total — as etapas de canais diferentes não
        se somam.
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {funis.map((f) => {
          const topo = Math.max(1, ...f.etapas.map((e) => e.valor));
          return (
            <div
              key={f.canal}
              className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
            >
              <div className="flex flex-col">
                <span className="text-sm font-medium">{f.canal}</span>
                {/* O período de CADA card: os três não são idênticos, e o do
                    GA4 nem segue o filtro. Ver `FunilCanal.periodo`. */}
                <span className="text-[11px] text-muted-foreground">{f.periodo}</span>
              </div>
              {f.etapas.map((e, i) => (
                <div key={e.rotulo} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="text-muted-foreground">{e.rotulo}</span>
                    <span className="font-medium tabular-nums">{int.format(e.valor)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max((e.valor / topo) * 100, 1)}%`,
                        background: CORES[i % CORES.length],
                      }}
                    />
                  </div>
                </div>
              ))}
              {f.aviso ? (
                <p className="text-[11px] text-amber-600 dark:text-amber-400">{f.aviso}</p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------- o painel ----------------------------------- //

/**
 * Navegação por MÊS, não por intervalo livre.
 *
 * O Painel é uma leitura mensal: as metas são mensais, e o delta é "vs mês
 * anterior". Um intervalo livre (tipo 12/07 a 03/08) não teria com o que
 * comparar nem casaria com meta nenhuma — o número perderia sentido no lugar de
 * ganhar liberdade.
 *
 * Usa `?comp=AAAA-MM`, o MESMO parâmetro da aba Metas: escolher agosto aqui
 * deixa agosto escolhido lá. Uma competência para o módulo inteiro.
 */
function SeletorMes({ competencia }: { competencia: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [ano, mes] = competencia.split("-").map(Number);
  const rotulo = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(ano, mes - 1, 1)));

  const irPara = (delta: number) => {
    const d = new Date(Date.UTC(ano, mes - 1 + delta, 1));
    const alvo = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const qs = new URLSearchParams(params.toString());
    qs.set("comp", alvo);
    qs.set("aba", "painel"); // não perder a aba ao navegar
    router.replace(`${pathname}?${qs}`, { scroll: false });
  };

  // Mês futuro não existe em dado nenhum — o botão some em vez de enganar.
  const hoje = new Date();
  const mesCorrente = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
  const podeAvancar = competencia < mesCorrente;

  const btn =
    "flex size-7 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted/60 disabled:opacity-30 disabled:hover:bg-transparent";

  return (
    <div className="flex items-center gap-1.5">
      <button type="button" onClick={() => irPara(-1)} className={btn} aria-label="Mês anterior">
        <IconChevronLeft className="size-4" />
      </button>
      <span className="min-w-36 text-center text-sm font-medium capitalize tabular-nums">
        {rotulo}
      </span>
      <button
        type="button"
        onClick={() => irPara(1)}
        disabled={!podeAvancar}
        className={btn}
        aria-label="Próximo mês"
      >
        <IconChevronRight className="size-4" />
      </button>
    </div>
  );
}

export function MarketingPainel({ data }: { data: PainelResumo }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight">Painel</h2>
          <p className="text-sm text-muted-foreground">
            {ddmm(data.desde)} a {ddmm(data.ate)} · comparado com {ddmm(data.anteriorDesde)}{" "}
            a {ddmm(data.anteriorAte)}
          </p>
        </div>
        <SeletorMes competencia={data.competencia} />
      </div>

      <FaixaSaude fontes={data.fontes} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <CardNumero titulo="Investimento" n={data.investimento} formato={brlCompact.format} />
        <CardNumero titulo="Resultados" n={data.resultados} formato={int.format} />
        <CardNumero titulo="Custo por resultado" n={data.custoResultado} formato={brl.format} />
        <CardNumero
          titulo="Audiência"
          n={data.audiencia}
          formato={(v) => (v > 0 ? `+${int.format(v)}` : int.format(v))}
          sufixo="seguidores e inscritos"
        />
      </div>

      <BlocoAlertas alertas={data.alertas} />
      <BlocoMetas metas={data.metas} />
      <BlocoMarcas marcas={data.marcas} />
      <BlocoTendencia pontos={data.tendencia} />
      <BlocoFunis funis={data.funis} />
    </div>
  );
}
