"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  IconRefresh,
  IconAlertTriangle,
  IconDeviceTv,
  IconBellDollar,
  IconChevronLeft,
  IconChevronRight,
} from "@tabler/icons-react";

import { PainelTv } from "@/components/financeiro/painel-tv";
import { Button } from "@/components/ui/button";
import type { BuMes, BuSerie, OrcamentoEstouro, PainelResumo } from "@/lib/financeiro/painel";

/**
 * Dashboard TV (Passo 12): visão executiva do ano — KPIs, alertas, e gráficos
 * (receita×despesa mensal, receita por BU, despesa por centro). Gráficos em CSS
 * puro (ethos do projeto: sem lib de chart). Gated por `financeiro` no server.
 */
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brlCompact = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function mesLabel(ym: string): string {
  const m = Number(ym.slice(5, 7));
  return MESES[(m - 1) % 12] ?? ym;
}
function fmtCarimbo(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
}

function Kpi({
  label,
  valor,
  tone = "default",
}: {
  label: string;
  valor: number;
  tone?: "default" | "good" | "bad" | "warn";
}) {
  const cls =
    tone === "good"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "bad"
        ? "text-destructive"
        : tone === "warn"
          ? "text-amber-600 dark:text-amber-400"
          : "";
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${cls}`}>{brl.format(valor)}</p>
    </div>
  );
}

/** Barras horizontais (nome · valor · barra), escaladas pelo maior valor. */
function BarList({ dados, cor }: { dados: { nome: string; valor: number }[]; cor: string }) {
  const max = Math.max(1, ...dados.map((d) => d.valor));
  if (dados.length === 0)
    return <p className="px-1 py-3 text-center text-xs text-muted-foreground">Sem dados.</p>;
  return (
    <div className="flex flex-col gap-1.5">
      {dados.map((d) => (
        <div key={d.nome} className="flex items-center gap-2">
          <span className="w-28 shrink-0 truncate text-xs" title={d.nome}>
            {d.nome}
          </span>
          <div className="h-3 flex-1 overflow-hidden rounded-full bg-muted">
            <div className={`h-full rounded-full ${cor}`} style={{ width: `${(d.valor / max) * 100}%` }} />
          </div>
          <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
            {brlCompact.format(d.valor)}
          </span>
        </div>
      ))}
    </div>
  );
}

const RECEITA_COR = "#10b981"; // verde — caminho da receita
const DESPESA_COR = "var(--destructive)"; // vermelho — caminho da despesa

/**
 * Linha ANUAL receita × despesa de UMA BU, com escala COMPARTILHADA (os dois
 * caminhos no mesmo eixo R$ → dá pra ler qual está acima). SVG puro, sem lib.
 */
function BuLineChart({ meses }: { meses: BuMes[] }) {
  const W = 640;
  const H = 190;
  const PAD = 14;
  const [hover, setHover] = useState<number | null>(null);
  const n = meses.length;
  const max = Math.max(1, ...meses.flatMap((m) => [m.receita, m.despesa]));
  const temDados = meses.some((m) => m.receita > 0 || m.despesa > 0);
  const x = (i: number) => (n <= 1 ? W / 2 : PAD + (i / (n - 1)) * (W - 2 * PAD));
  const y = (v: number) => H - PAD - (v / max) * (H - 2 * PAD);
  const path = (key: "receita" | "despesa") =>
    meses.map((m, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(m[key]).toFixed(1)}`).join(" ");

  if (!temDados)
    return (
      <div className="flex h-44 items-center justify-center px-4 text-center text-xs text-muted-foreground">
        Sem receita nem despesa lançada nesta unidade no ano.
      </div>
    );

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || n <= 1) return;
    const frac = (e.clientX - rect.left) / rect.width;
    setHover(Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1)))));
  };

  return (
    <div className="relative" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Receita e despesa por mês">
        <defs>
          <linearGradient id="bu-rec-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={RECEITA_COR} stopOpacity="0.22" />
            <stop offset="1" stopColor={RECEITA_COR} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" y1={H * f} x2={W} y2={H * f} stroke="var(--border)" strokeWidth="1" />
        ))}
        <path d={`${path("receita")} L${x(n - 1)},${H} L${x(0)},${H} Z`} fill="url(#bu-rec-area)" />
        <path d={path("despesa")} fill="none" stroke={DESPESA_COR} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" strokeDasharray="5 3" />
        <path d={path("receita")} fill="none" stroke={RECEITA_COR} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {hover != null ? (
          <g pointerEvents="none">
            <line x1={x(hover)} y1={PAD} x2={x(hover)} y2={H} stroke="var(--muted-foreground)" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
            {(["receita", "despesa"] as const).map((key) => (
              <circle key={key} cx={x(hover)} cy={y(meses[hover][key])} r="4" fill={key === "receita" ? RECEITA_COR : DESPESA_COR} stroke="var(--card)" strokeWidth="1.5" />
            ))}
          </g>
        ) : (
          (["receita", "despesa"] as const).map((key) => (
            <circle key={key} cx={x(n - 1)} cy={y(meses[n - 1][key])} r="3.5" fill={key === "receita" ? RECEITA_COR : DESPESA_COR} />
          ))
        )}
      </svg>
      {hover != null ? (
        <div
          className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 rounded-md border border-border bg-popover px-2 py-1 text-[11px] shadow-md"
          style={{ left: `${(x(hover) / W) * 100}%` }}
        >
          <p className="mb-0.5 font-medium">{mesLabel(meses[hover].mes)}</p>
          <p className="tabular-nums" style={{ color: RECEITA_COR }}>{brl.format(meses[hover].receita)}</p>
          <p className="tabular-nums text-destructive">{brl.format(meses[hover].despesa)}</p>
        </div>
      ) : null}
      <div className="mt-1 flex justify-between px-1 text-[10px] text-muted-foreground">
        {meses.map((m) => (
          <span key={m.mes}>{mesLabel(m.mes).charAt(0).toUpperCase()}</span>
        ))}
      </div>
    </div>
  );
}

/** Despesa FIXA (veio de recorrência) × VARIÁVEL de uma BU — duas barras + %. */
function FixaVariavelChart({ serie }: { serie: BuSerie }) {
  const total = serie.fixa + serie.variavel;
  if (total <= 0)
    return (
      <div className="flex h-full min-h-32 flex-col items-center justify-center gap-1 px-4 text-center text-xs text-muted-foreground">
        <p>Sem despesa classificada nesta unidade.</p>
        <p className="text-[11px]">
          Uma despesa vira <strong>fixa</strong> quando nasce de uma recorrência (Passo 8). Hoje
          tudo é importado do Conta Azul → ainda sem fixas.
        </p>
      </div>
    );
  const pct = (v: number) => Math.round((v / total) * 100);
  const linhas = [
    { nome: "Fixa (recorrente)", valor: serie.fixa, cor: "bg-indigo-500" },
    { nome: "Variável", valor: serie.variavel, cor: "bg-sky-400" },
  ];
  return (
    <div className="flex flex-col gap-2.5 py-1">
      {linhas.map((l) => (
        <div key={l.nome} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-muted-foreground">{l.nome}</span>
            <span className="tabular-nums">
              {brl.format(l.valor)} <span className="text-muted-foreground">· {pct(l.valor)}%</span>
            </span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-muted">
            <div className={`h-full rounded-full ${l.cor}`} style={{ width: `${pct(l.valor)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Bloco que MESCLA as BUs: um seletor com rotação automática (CPPEM → Colégio →
 * Unicive → …) alimentando a linha anual e o fixa×variável ao mesmo tempo. Clicar
 * numa pill (ou nas setas) fixa a BU e pausa a rotação.
 */
function MesclaBu({ porBu }: { porBu: BuSerie[] }) {
  const [idx, setIdx] = useState(0);
  const [pausado, setPausado] = useState(false);
  const total = porBu.length;

  useEffect(() => {
    if (total <= 1 || pausado) return;
    const id = setInterval(() => setIdx((i) => (i + 1) % total), 7000);
    return () => clearInterval(id);
  }, [total, pausado]);

  if (total === 0)
    return (
      <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
        Sem séries por unidade ainda — a receita por BU já entra; a despesa por BU acende no Passo 11
        (mapear centro/BU na importação).
      </div>
    );

  const cur = idx % total;
  const serie = porBu[cur];
  const go = (d: number) => {
    setPausado(true);
    setIdx((i) => (i + d + total) % total);
  };

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">Por unidade (BU) · ano</p>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: RECEITA_COR }} /> Receita
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-destructive" /> Despesa
          </span>
        </span>
        <div className="ml-auto flex items-center gap-1">
          {total > 1 && (
            <button
              type="button"
              onClick={() => go(-1)}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted"
              aria-label="Unidade anterior"
            >
              <IconChevronLeft className="h-4 w-4" />
            </button>
          )}
          {porBu.map((s, i) => (
            <button
              key={s.buId ?? s.bu}
              type="button"
              onClick={() => {
                setPausado(true);
                setIdx(i);
              }}
              className={`rounded-full px-2.5 py-0.5 text-xs transition-colors ${
                i === cur ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {s.bu}
            </button>
          ))}
          {total > 1 && (
            <button
              type="button"
              onClick={() => go(1)}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted"
              aria-label="Próxima unidade"
            >
              <IconChevronRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.7fr_1fr]">
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            {serie.bu} — receita × despesa mês a mês
          </p>
          <BuLineChart meses={serie.meses} />
        </div>
        <div className="flex flex-col">
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            {serie.bu} — despesa fixa × variável
          </p>
          <FixaVariavelChart serie={serie} />
        </div>
      </div>
      {!pausado && total > 1 && (
        <p className="mt-2 text-right text-[10px] text-muted-foreground">
          Alternando entre unidades · clique numa unidade para fixar
        </p>
      )}
    </div>
  );
}

/** Card de estouro de orçamento como LISTA (qual categoria/BU passou do orçado). */
function OrcamentoAlertas({
  alertas,
  definidos,
}: {
  alertas: OrcamentoEstouro[];
  definidos: boolean;
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
        <IconBellDollar className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        Orçamentos estourados <span className="text-xs font-normal text-muted-foreground">· mês atual</span>
      </p>
      {!definidos ? (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          Nenhum orçamento cadastrado. Defina limites por categoria/BU na aba{" "}
          <strong>Orçamento</strong> para receber avisos quando o previsto passar do orçado.
        </p>
      ) : alertas.length === 0 ? (
        <p className="px-1 py-3 text-center text-xs text-muted-foreground">
          Nenhuma categoria estourou o orçamento este mês. 👍
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {alertas.map((a) => (
            <li key={`${a.categoria}|${a.bu}`} className="flex items-center gap-2 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{a.categoria}</p>
                <p className="text-xs text-muted-foreground">
                  {a.bu} · orçado {brlCompact.format(a.orcado)} · previsto {brlCompact.format(a.previsto)}
                </p>
              </div>
              <span className="shrink-0 rounded-md bg-destructive/10 px-2 py-1 text-xs font-semibold tabular-nums text-destructive">
                +{brlCompact.format(a.excedente)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PainelPanel() {
  const [data, setData] = useState<PainelResumo | null>(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const url = force ? "/api/financeiro/painel?fresh=1" : "/api/financeiro/painel";
      const j = (await fetch(url).then((r) => r.json())) as PainelResumo | { error: string };
      if ("error" in j) throw new Error(j.error);
      setData(j);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // ---- Modo TV (tela cheia + carrossel) ----
  const wrapperRef = useRef<HTMLElement>(null);
  const [tvMode, setTvMode] = useState(false);

  // Sincroniza com a Fullscreen API (Esc sai do fullscreen → sai do modo TV).
  useEffect(() => {
    const onFs = () => setTvMode(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const entrarTv = useCallback(async () => {
    try {
      await wrapperRef.current?.requestFullscreen();
    } catch {
      setTvMode(true); // fallback: overlay mesmo sem fullscreen
    }
  }, []);
  const sairTv = useCallback(async () => {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    setTvMode(false);
  }, []);

  // Na TV, atualiza os dados sozinho a cada 5 min (parede sempre atual).
  useEffect(() => {
    if (!tvMode) return;
    const id = setInterval(() => void refetch(true), 5 * 60_000);
    return () => clearInterval(id);
  }, [tvMode, refetch]);

  const k = data?.kpis;
  const maxFluxo = Math.max(
    1,
    ...(data?.fluxoMensal ?? []).flatMap((m) => [m.receita, m.despesa]),
  );

  return (
    <section ref={wrapperRef} className="flex flex-col gap-4">
      {tvMode && data && <PainelTv data={data} onExit={sairTv} />}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-sm font-semibold">Painel — visão do ano {data?.ano ?? ""}</h2>
          <p className="text-xs text-muted-foreground">
            Financeiro consolidado (Conta Azul + nossas tabelas)
            {data ? ` · atualizado ${fmtCarimbo(data.atualizadoEm)}` : ""}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => void entrarTv()}
            title="Abrir em tela cheia com rotação automática de telas"
          >
            <IconDeviceTv className="h-4 w-4" />
            Modo TV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetch(true)}
            disabled={loading}
            title="Recalcula ao vivo (ignora o cache de 5 min)"
          >
            <IconRefresh className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            Atualizar
          </Button>
        </div>
      </div>

      {loading && !data && (
        <p className="px-3 py-8 text-center text-sm text-muted-foreground">Carregando painel…</p>
      )}

      {data && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Kpi label="Receita recebida" valor={k!.receitaRecebida} tone="good" />
            <Kpi label="Despesa paga" valor={k!.despesaPaga} tone="bad" />
            <Kpi
              label="Resultado"
              valor={k!.resultado}
              tone={k!.resultado >= 0 ? "good" : "bad"}
            />
            <Kpi label="Saldo previsto" valor={k!.saldoPrevisto} />
            <Kpi label="A receber" valor={k!.aReceber} />
            <Kpi label="Inadimplência (vencido)" valor={k!.vencidoReceber} tone="bad" />
            <Kpi label="Vendas faturadas" valor={k!.vendasFaturado} tone="good" />
            <Kpi label="A faturar (NF pendente)" valor={k!.vendasAFaturar} tone="warn" />
          </div>

          {/* Alertas */}
          {data.alertas.length > 0 && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
              <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                <IconAlertTriangle className="h-4 w-4" /> Alertas
              </p>
              <ul className="flex flex-col gap-1 text-sm">
                {data.alertas.map((a) => (
                  <li key={a.tipo} className="text-amber-800 dark:text-amber-300">
                    • {a.texto}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Estouro de orçamento (lista) */}
          <OrcamentoAlertas alertas={data.alertasOrcamento} definidos={data.orcamentosDefinidos} />

          {!data.connected && (
            <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              Conta Azul indisponível — alguns números podem estar zerados.
            </p>
          )}

          {/* Receita × Despesa mensal */}
          <div className="rounded-lg border border-border p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium">Receita × Despesa por mês</p>
              <p className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-primary" /> Receita
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-destructive" /> Despesa
                </span>
              </p>
            </div>
            <div className="flex h-40 items-end gap-1">
              {data.fluxoMensal.map((m) => (
                <div key={m.mes} className="flex flex-1 flex-col items-center gap-1">
                  <div className="flex h-32 w-full items-end justify-center gap-0.5">
                    <div
                      className="w-1/2 max-w-3 rounded-t bg-primary"
                      style={{ height: `${(m.receita / maxFluxo) * 100}%` }}
                      title={`Receita ${brl.format(m.receita)}`}
                    />
                    <div
                      className="w-1/2 max-w-3 rounded-t bg-destructive"
                      style={{ height: `${(m.despesa / maxFluxo) * 100}%` }}
                      title={`Despesa ${brl.format(m.despesa)}`}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground">{mesLabel(m.mes)}</span>
                </div>
              ))}
              {data.fluxoMensal.length === 0 && (
                <p className="w-full py-8 text-center text-xs text-muted-foreground">Sem dados.</p>
              )}
            </div>
          </div>

          {/* Mescla BUs: linha anual receita×despesa + fixa×variável (rotação automática) */}
          <MesclaBu porBu={data.porBu} />

          {/* Receita por BU + Despesa por centro */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="rounded-lg border border-border p-3">
              <p className="mb-2 text-sm font-medium">Receita por unidade (BU)</p>
              <BarList dados={data.receitaPorBu} cor="bg-primary" />
            </div>
            <div className="rounded-lg border border-border p-3">
              <div className="mb-2 flex items-baseline justify-between">
                <p className="text-sm font-medium">Despesa por centro de custo</p>
                <span className="text-[10px] text-muted-foreground">via Conta Azul</span>
              </div>
              <BarList dados={data.despesaPorCentro} cor="bg-destructive" />
            </div>
          </div>
        </>
      )}
    </section>
  );
}
