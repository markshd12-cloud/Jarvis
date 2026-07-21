"use client";

import { useCallback, useEffect, useState } from "react";
import {
  IconChevronLeft,
  IconChevronRight,
  IconPlayerPause,
  IconPlayerPlay,
  IconX,
} from "@tabler/icons-react";

import type { PainelResumo } from "@/lib/financeiro/painel";

/**
 * Modo TV (Passo 12+): kiosk em tela cheia que roda os slides do Painel em
 * carrossel automático (default 10s), voltando ao primeiro no fim. Visuais
 * TV-scaled (números gigantes, alto contraste). Controles: pausar, ←/→, sair.
 * Consome o mesmo `PainelResumo` do Painel — sem fetch próprio.
 */
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brlC = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const mesLabel = (ym: string) => MESES[(Number(ym.slice(5, 7)) - 1) % 12] ?? ym;

const SLIDES = ["Visão Geral", "Receita × Despesa", "Vendas & Faturamento", "Inadimplência"] as const;

// ------------------------------- Slides ------------------------------------ //

function Hero({
  label,
  valor,
  tone,
}: {
  label: string;
  valor: number;
  tone?: "good" | "bad" | "warn";
}) {
  const cls =
    tone === "good"
      ? "text-emerald-400"
      : tone === "bad"
        ? "text-red-400"
        : tone === "warn"
          ? "text-amber-400"
          : "text-foreground";
  return (
    <div className="flex min-h-0 flex-col justify-center overflow-hidden rounded-2xl border border-border bg-card/40 px-5 py-3">
      <p className="truncate text-sm text-muted-foreground xl:text-base">{label}</p>
      <p className={`mt-0.5 truncate text-2xl font-bold tabular-nums xl:text-3xl ${cls}`}>
        {brl.format(valor)}
      </p>
    </div>
  );
}

function SlideVisaoGeral({ data }: { data: PainelResumo }) {
  const k = data.kpis;
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 md:grid-cols-4 md:grid-rows-2">
        <Hero label="Receita recebida" valor={k.receitaRecebida} tone="good" />
        <Hero label="Despesa paga" valor={k.despesaPaga} tone="bad" />
        <Hero label="Resultado" valor={k.resultado} tone={k.resultado >= 0 ? "good" : "bad"} />
        <Hero label="Saldo previsto" valor={k.saldoPrevisto} />
        <Hero label="A receber" valor={k.aReceber} />
        <Hero label="Inadimplência (vencido)" valor={k.vencidoReceber} tone="bad" />
        <Hero label="Vendas faturadas" valor={k.vendasFaturado} tone="good" />
        <Hero label="A faturar (NF pendente)" valor={k.vendasAFaturar} tone="warn" />
      </div>
      {data.alertas.length > 0 && (
        <div className="shrink-0 rounded-xl border border-amber-500/40 bg-amber-500/10 px-5 py-3">
          <p className="mb-1 text-base font-semibold text-amber-400">⚠ Alertas</p>
          <ul className="flex flex-wrap gap-x-8 gap-y-1 text-base text-amber-300 xl:text-lg">
            {data.alertas.map((a) => (
              <li key={a.tipo}>• {a.texto}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SlideReceitaDespesa({ data }: { data: PainelResumo }) {
  const fluxo = data.fluxoMensal;
  const max = Math.max(1, ...fluxo.flatMap((m) => [m.receita, m.despesa]));
  const totRec = fluxo.reduce((s, m) => s + m.receita, 0);
  const totDes = fluxo.reduce((s, m) => s + m.despesa, 0);
  const result = totRec - totDes;
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex shrink-0 items-center justify-end gap-6 text-lg text-muted-foreground">
        <span className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-full bg-primary" /> Receita
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-full bg-red-500" /> Despesa
        </span>
      </div>
      <div className="flex min-h-0 flex-1 items-stretch gap-2">
        {fluxo.map((m) => (
          <div key={m.mes} className="flex h-full min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 items-end justify-center gap-1">
              <div
                className="w-1/2 max-w-10 rounded-t bg-primary"
                style={{ height: `${(m.receita / max) * 100}%` }}
                title={`Receita ${brl.format(m.receita)}`}
              />
              <div
                className="w-1/2 max-w-10 rounded-t bg-red-500"
                style={{ height: `${(m.despesa / max) * 100}%` }}
                title={`Despesa ${brl.format(m.despesa)}`}
              />
            </div>
            <span className="shrink-0 pt-2 text-center text-sm text-muted-foreground">
              {mesLabel(m.mes)}
            </span>
          </div>
        ))}
        {fluxo.length === 0 && (
          <p className="w-full self-center text-center text-xl text-muted-foreground">Sem dados.</p>
        )}
      </div>
      <div className="grid shrink-0 grid-cols-3 gap-3">
        <Hero label="Receita no ano" valor={totRec} tone="good" />
        <Hero label="Despesa no ano" valor={totDes} tone="bad" />
        <Hero label="Resultado" valor={result} tone={result >= 0 ? "good" : "bad"} />
      </div>
    </div>
  );
}

function SlideVendas({ data }: { data: PainelResumo }) {
  const fat = data.kpis.vendasFaturado;
  const aFat = data.kpis.vendasAFaturar;
  const tot = fat + aFat;
  const pFat = tot > 0 ? (fat / tot) * 100 : 0;
  return (
    <div className="flex h-full flex-col justify-center gap-10">
      <div className="grid grid-cols-2 gap-6">
        <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-8 py-8 text-center">
          <p className="text-xl text-emerald-300">Faturado (NF emitida)</p>
          <p className="mt-2 text-5xl font-bold tabular-nums text-emerald-400 xl:text-6xl">
            {brl.format(fat)}
          </p>
        </div>
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-8 py-8 text-center">
          <p className="text-xl text-amber-300">A faturar (NF pendente)</p>
          <p className="mt-2 text-5xl font-bold tabular-nums text-amber-400 xl:text-6xl">
            {brl.format(aFat)}
          </p>
        </div>
      </div>
      <div>
        <div className="mb-2 flex justify-between text-lg text-muted-foreground">
          <span>{pFat.toFixed(1)}% faturado</span>
          <span>Total {brl.format(tot)}</span>
        </div>
        <div className="flex h-8 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-emerald-500" style={{ width: `${pFat}%` }} />
          <div className="h-full bg-amber-500" style={{ width: `${100 - pFat}%` }} />
        </div>
      </div>
    </div>
  );
}

function SlideInadimplencia({ data }: { data: PainelResumo }) {
  const devedores = data.topDevedores;
  const max = Math.max(1, ...devedores.map((d) => d.valor));
  return (
    <div className="flex h-full flex-col gap-6">
      <div className="grid grid-cols-2 gap-6">
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-8 py-6 text-center">
          <p className="text-xl text-red-300">Total vencido a receber</p>
          <p className="mt-1 text-5xl font-bold tabular-nums text-red-400 xl:text-6xl">
            {brl.format(data.kpis.vencidoReceber)}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card/40 px-8 py-6 text-center">
          <p className="text-xl text-muted-foreground">Clientes inadimplentes</p>
          <p className="mt-1 text-5xl font-bold tabular-nums xl:text-6xl">
            {data.inadimplentesClientes}
          </p>
        </div>
      </div>
      <div className="flex flex-1 flex-col justify-center gap-3">
        <p className="text-lg text-muted-foreground">Maiores devedores</p>
        {devedores.map((d) => (
          <div key={d.nome} className="flex items-center gap-4">
            <span className="w-64 shrink-0 truncate text-xl" title={d.nome}>
              {d.nome}
            </span>
            <div className="h-5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-red-500"
                style={{ width: `${(d.valor / max) * 100}%` }}
              />
            </div>
            <span className="w-28 shrink-0 text-right text-xl font-semibold tabular-nums">
              {brlC.format(d.valor)}
            </span>
          </div>
        ))}
        {devedores.length === 0 && (
          <p className="py-10 text-center text-xl text-muted-foreground">Nenhum inadimplente. 🎉</p>
        )}
      </div>
    </div>
  );
}

// ------------------------------- Kiosk ------------------------------------- //

export function PainelTv({
  data,
  onExit,
  segundos = 10,
}: {
  data: PainelResumo;
  onExit: () => void;
  segundos?: number;
}) {
  const [slide, setSlide] = useState(0);
  const [prog, setProg] = useState(0);
  const [pausado, setPausado] = useState(false);
  const n = SLIDES.length;

  const goto = useCallback((i: number) => setSlide(((i % n) + n) % n), [n]);
  const next = useCallback(() => goto(slide + 1), [goto, slide]);
  const prev = useCallback(() => goto(slide - 1), [goto, slide]);

  // Timer + barra de progresso unificados (reinicia a cada slide; pausável).
  useEffect(() => {
    setProg(0);
    if (pausado) return;
    const start = performance.now();
    const id = setInterval(() => {
      const p = Math.min(1, (performance.now() - start) / (segundos * 1000));
      setProg(p);
      if (p >= 1) {
        clearInterval(id);
        setSlide((s) => (s + 1) % n);
      }
    }, 80);
    return () => clearInterval(id);
  }, [slide, pausado, segundos, n]);

  // Teclado: ←/→ navega, espaço pausa, Esc sai.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === " ") {
        e.preventDefault();
        setPausado((p) => !p);
      } else if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, onExit]);

  const slideEl = [
    <SlideVisaoGeral key="0" data={data} />,
    <SlideReceitaDespesa key="1" data={data} />,
    <SlideVendas key="2" data={data} />,
    <SlideInadimplencia key="3" data={data} />,
  ][slide];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background text-foreground">
      {/* Barra de progresso do slide */}
      <div className="h-1 w-full bg-muted">
        <div
          className="h-full bg-primary transition-[width] duration-75 ease-linear"
          style={{ width: `${prog * 100}%` }}
        />
      </div>

      {/* Header */}
      <header className="flex items-center gap-4 px-8 pt-5">
        <h1 className="text-2xl font-bold xl:text-3xl">{SLIDES[slide]}</h1>
        <span className="rounded-full bg-muted px-3 py-1 text-sm text-muted-foreground">
          {data.ano}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setPausado((p) => !p)}
            className="rounded-lg border border-border p-2 hover:bg-muted"
            title={pausado ? "Retomar (espaço)" : "Pausar (espaço)"}
          >
            {pausado ? <IconPlayerPlay className="h-5 w-5" /> : <IconPlayerPause className="h-5 w-5" />}
          </button>
          <button onClick={prev} className="rounded-lg border border-border p-2 hover:bg-muted" title="Anterior (←)">
            <IconChevronLeft className="h-5 w-5" />
          </button>
          <button onClick={next} className="rounded-lg border border-border p-2 hover:bg-muted" title="Próximo (→)">
            <IconChevronRight className="h-5 w-5" />
          </button>
          <button onClick={onExit} className="rounded-lg border border-border p-2 hover:bg-muted" title="Sair (Esc)">
            <IconX className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* Slide */}
      <main className="min-h-0 flex-1 overflow-hidden px-8 py-5">{slideEl}</main>

      {/* Dots */}
      <footer className="flex items-center justify-center gap-3 pb-5">
        {SLIDES.map((s, i) => (
          <button
            key={s}
            onClick={() => goto(i)}
            title={s}
            className={`h-2.5 rounded-full transition-all ${
              i === slide ? "w-8 bg-primary" : "w-2.5 bg-muted hover:bg-muted-foreground/40"
            }`}
          />
        ))}
      </footer>
    </div>
  );
}
