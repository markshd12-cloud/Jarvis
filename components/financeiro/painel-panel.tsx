"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IconRefresh, IconAlertTriangle, IconDeviceTv } from "@tabler/icons-react";

import { PainelTv } from "@/components/financeiro/painel-tv";
import { Button } from "@/components/ui/button";
import type { PainelResumo } from "@/lib/financeiro/painel";

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
