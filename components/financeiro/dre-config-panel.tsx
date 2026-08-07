"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import {
  IconChevronRight,
  IconDownload,
  IconListCheck,
  IconRefresh,
  IconScale,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DreConfig } from "@/lib/financeiro/dre-config";
import type { ImportDespesasResult } from "@/lib/financeiro/import-despesas";
import type {
  ReconciliacaoResult,
  ReconPeriodoResult,
} from "@/lib/financeiro/reconciliacao";

/**
 * Gestão do DRE v2 (Passo 11): importa a despesa do Conta Azul pras nossas
 * tabelas, reconcilia CA × Jarvis na competência (o PORTÃO) e vira o cutover —
 * a competência a partir da qual o DRE lê a despesa do Jarvis, não do CA.
 * Receita nunca muda de fonte. `competencia` = a selecionada no DRE.
 */
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function labelComp(ym: string): string {
  const [y, m] = ym.split("-");
  return `${m}/${y}`;
}

/**
 * Competências pro cutover: 3 meses À FRENTE … 17 atrás (recente → antigo).
 * O futuro é obrigatório aqui: na virada de mês o cutover natural é o mês que
 * ESTÁ COMEÇANDO (ex.: em 31/07, cortar a partir de 08/2026) — e a lista
 * só-passado tornava esse corte impossível de selecionar.
 */
function ultimasCompetencias(): string[] {
  const now = new Date();
  return Array.from({ length: 21 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + 3 - i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
}

const selectCls =
  "h-8 rounded-lg border border-input bg-background px-2.5 text-sm text-foreground outline-none [color-scheme:light] dark:[color-scheme:dark] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function DreConfigPanel({
  competencia,
  onChanged,
}: {
  competencia: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState<DreConfig | null>(null);
  const [recon, setRecon] = useState<ReconciliacaoResult | null>(null);
  const [periodo, setPeriodo] = useState<ReconPeriodoResult | null>(null);
  const [busy, setBusy] = useState<null | "import" | "cutover" | "recon" | "periodo">(null);
  // Grupos abertos no detalhamento do Δ (por categoria).
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  /**
   * Teto de competência do import ('AAAA-MM'; vazio = sem teto). Protege os meses
   * que já estão sendo lançados à mão: recuperar histórico sem trazer de volta o
   * que foi digitado no Jarvis.
   */
  const [ateComp, setAteComp] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const carregarCfg = useCallback(async () => {
    try {
      const j = await fetch("/api/financeiro/dre-config", { cache: "no-store" }).then((r) =>
        r.json(),
      );
      if (j.error) throw new Error(j.error);
      setCfg(j as DreConfig);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const carregarRecon = useCallback(async () => {
    setBusy("recon");
    try {
      const j: ReconciliacaoResult = await fetch(
        `/api/financeiro/reconciliacao?competencia=${competencia}`,
        { cache: "no-store" },
      ).then((r) => r.json());
      setRecon(j);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, [competencia]);

  const carregarPeriodo = useCallback(async () => {
    setBusy("periodo");
    setError(null);
    try {
      const j: ReconPeriodoResult = await fetch(
        "/api/financeiro/reconciliacao/periodo?meses=12",
        { cache: "no-store" },
      ).then((r) => r.json());
      setPeriodo(j);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    void carregarCfg();
  }, [carregarCfg]);

  useEffect(() => {
    if (open) void carregarRecon();
  }, [open, carregarRecon]);

  const importar = async () => {
    setBusy("import");
    setError(null);
    setMsg(null);
    try {
      const r: ImportDespesasResult = await fetch("/api/financeiro/despesas/importar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          meses: 12,
          ...(ateComp ? { ateCompetencia: ateComp } : {}),
        }),
      }).then((res) => res.json());
      if (!r.connected) {
        setError(r.erro ?? "Conta Azul indisponível.");
      } else {
        let t = `${r.novos} nova(s) despesa(s) importada(s), ${r.jaImportados} já existia(m).`;
        if (r.fornecedoresCriados)
          t += ` ${r.fornecedoresCriados} fornecedor(es) criado(s) a partir do CA.`;
        if (r.comFornecedor) t += ` ${r.comFornecedor} despesa(s) vinculada(s) a uma pessoa.`;
        if (r.foraDoTeto)
          t += ` ${r.foraDoTeto} ignorada(s) por serem depois de ${labelComp(r.ateCompetencia ?? "")}.`;
        if (r.semCategoria) t += ` ${r.semCategoria} sem categoria (puladas).`;
        if (r.buGeralFaltando) t += " ⚠ Rode o seed: falta a BU “Geral”.";
        setMsg(t);
        await carregarRecon();
        onChanged();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const mudarCutover = async (valor: string) => {
    setBusy("cutover");
    setError(null);
    setMsg(null);
    try {
      const j = await fetch("/api/financeiro/dre-config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ competencia: valor || null }),
      }).then((r) => r.json());
      if (j.error) throw new Error(j.error);
      setCfg(j as DreConfig);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const cutover = cfg?.cutover_competencia ?? null;
  const cortada = cutover != null && competencia >= cutover;

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
      >
        <IconChevronRight
          className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-90")}
        />
        <IconScale className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">Gestão do DRE (v2)</span>
        <span
          className={cn(
            "ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium",
            cortada
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "bg-muted text-muted-foreground",
          )}
        >
          {cutover
            ? `Cutover: ${labelComp(cutover)} · esta competência lê ${cortada ? "Jarvis" : "Conta Azul"}`
            : "Sem cutover — tudo do Conta Azul"}
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-4 border-t border-border px-4 py-4">
          {/* Passo 1 — importar despesa do CA */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium">1 · Importar despesa do Conta Azul</p>
              <p className="text-[11px] text-muted-foreground">
                Traz as despesas pras nossas tabelas (insert-only, sem duplicar). Enriqueça
                BU/centro depois em Contas a Pagar.
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <label
                className="text-[11px] text-muted-foreground"
                title="Nada de competência POSTERIOR a este mês é importado — protege os meses já lançados à mão. Vazio = sem limite."
              >
                até a competência:
              </label>
              <input
                type="month"
                className={cn(selectCls, "w-36")}
                value={ateComp}
                onChange={(e) => setAteComp(e.target.value)}
              />
              {ateComp && (
                <button
                  type="button"
                  className="rounded border border-border px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-muted"
                  onClick={() => setAteComp("")}
                  title="Sem limite"
                >
                  limpar
                </button>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() => void importar()}
              >
                <IconDownload
                  className={busy === "import" ? "h-4 w-4 animate-pulse" : "h-4 w-4"}
                />
                {busy === "import" ? "Importando…" : "Importar (12 meses)"}
              </Button>
            </div>
          </div>

          {/* Passo 2 — reconciliar */}
          <div className="rounded-lg border border-border">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <p className="text-xs font-medium">
                2 · Reconciliação da despesa — {labelComp(competencia)}
              </p>
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto h-6 w-6"
                disabled={busy !== null}
                onClick={() => void carregarRecon()}
                title="Recalcular"
              >
                <IconRefresh className={busy === "recon" ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              </Button>
            </div>
            {recon && recon.connected ? (
              <div className="px-3 py-2">
                <table className="fin-table w-full text-xs">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="py-1 font-medium">Grupo</th>
                      <th className="py-1 text-right font-medium">Conta Azul</th>
                      <th className="py-1 text-right font-medium">Jarvis</th>
                      <th className="py-1 text-right font-medium">Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recon.porGrupo.map((g) => {
                      const cats = (recon.porCategoria ?? []).filter((c) => c.grupo === g.grupo);
                      const diverge = Math.abs(g.delta) > 0.01;
                      const open2 = abertos.has(g.grupo);
                      return (
                        <Fragment key={g.grupo}>
                          <tr
                            className={cn("border-t border-border/60", cats.length > 0 && "cursor-pointer hover:bg-muted/30")}
                            onClick={() =>
                              cats.length > 0 &&
                              setAbertos((s) => {
                                const n = new Set(s);
                                if (n.has(g.grupo)) n.delete(g.grupo);
                                else n.add(g.grupo);
                                return n;
                              })
                            }
                          >
                            <td className="py-1">
                              <span className="flex items-center gap-1">
                                {cats.length > 0 ? (
                                  <IconChevronRight
                                    className={cn("h-3 w-3 shrink-0 transition-transform", open2 && "rotate-90")}
                                  />
                                ) : (
                                  <span className="w-3" />
                                )}
                                {g.label}
                                {cats.length > 0 && (
                                  <span className="rounded bg-amber-500/10 px-1 text-[10px] text-amber-600 dark:text-amber-400">
                                    {cats.length}
                                  </span>
                                )}
                              </span>
                            </td>
                            <td className="py-1 text-right tabular-nums">{brl.format(g.ca)}</td>
                            <td className="py-1 text-right tabular-nums">{brl.format(g.jarvis)}</td>
                            <td
                              className={cn(
                                "py-1 text-right tabular-nums",
                                diverge ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
                              )}
                            >
                              {brl.format(g.delta)}
                            </td>
                          </tr>
                          {open2 &&
                            cats.map((c) => (
                              <tr key={`${g.grupo}-${c.nome}`} className="bg-muted/20">
                                <td className="py-1 pl-6 text-muted-foreground">
                                  {c.nome}
                                  {c.jarvisManual > 0.01 && (
                                    <span
                                      className="ml-1 rounded fin-tag px-1 text-[10px]"
                                      title="Lançado à mão no Jarvis — o Conta Azul não tem"
                                    >
                                      manual {brl.format(c.jarvisManual)}
                                    </span>
                                  )}
                                </td>
                                <td className="py-1 text-right tabular-nums text-muted-foreground">
                                  {brl.format(c.ca)}
                                </td>
                                <td className="py-1 text-right tabular-nums text-muted-foreground">
                                  {brl.format(c.jarvis)}
                                </td>
                                <td className="py-1 text-right tabular-nums text-amber-600 dark:text-amber-400">
                                  {brl.format(c.delta)}
                                </td>
                              </tr>
                            ))}
                        </Fragment>
                      );
                    })}
                    {recon.porGrupo.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-2 text-center text-muted-foreground">
                          Sem despesa nos dois lados nesta competência.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot className="border-t border-border font-medium">
                    <tr>
                      <td className="py-1.5">Total</td>
                      <td className="py-1.5 text-right tabular-nums">{brl.format(recon.ca)}</td>
                      <td className="py-1.5 text-right tabular-nums">{brl.format(recon.jarvis)}</td>
                      <td
                        className={cn(
                          "py-1.5 text-right tabular-nums",
                          recon.ok ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400",
                        )}
                      >
                        {brl.format(recon.delta)} {recon.ok ? "✓" : ""}
                      </td>
                    </tr>
                  </tfoot>
                </table>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {recon.ok
                    ? "Δ ≈ 0 — seguro cortar esta competência pro Jarvis."
                    : "Δ ≠ 0 — clique num grupo para ver QUAIS categorias divergem. Δ positivo = o Jarvis tem a mais (ex.: lançamento “manual”, que o CA não tem). Δ negativo = o CA tem algo que falta importar."}
                </p>
              </div>
            ) : (
              <p className="px-3 py-3 text-center text-xs text-muted-foreground">
                {busy === "recon" ? "Calculando…" : recon?.erro ?? "—"}
              </p>
            )}
          </div>

          {/* Conferência de período (todos os meses de uma vez) */}
          <div className="rounded-lg border border-border">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <p className="text-xs font-medium">Conferência de todos os meses (12)</p>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto h-7"
                disabled={busy !== null}
                onClick={() => void carregarPeriodo()}
              >
                <IconListCheck
                  className={busy === "periodo" ? "h-4 w-4 animate-pulse" : "h-4 w-4"}
                />
                {busy === "periodo" ? "Conferindo…" : "Conferir período"}
              </Button>
            </div>
            {periodo && periodo.connected ? (
              <div className="px-3 py-2">
                <table className="fin-table w-full text-xs">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="py-1 font-medium">Competência</th>
                      <th className="py-1 text-right font-medium">Conta Azul</th>
                      <th className="py-1 text-right font-medium">Jarvis</th>
                      <th className="py-1 text-right font-medium">Δ</th>
                      <th className="py-1 text-center font-medium">OK</th>
                    </tr>
                  </thead>
                  <tbody>
                    {periodo.meses.map((m) => (
                      <tr key={m.competencia} className="border-t border-border/60">
                        <td className="py-1">{labelComp(m.competencia)}</td>
                        <td className="py-1 text-right tabular-nums">{brl.format(m.ca)}</td>
                        <td className="py-1 text-right tabular-nums">{brl.format(m.jarvis)}</td>
                        <td
                          className={cn(
                            "py-1 text-right tabular-nums",
                            m.ok ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400",
                          )}
                        >
                          {brl.format(m.delta)}
                        </td>
                        <td className="py-1 text-center">
                          {m.ok ? (
                            <span className="text-emerald-600 dark:text-emerald-400">✓</span>
                          ) : (
                            <span className="text-amber-600 dark:text-amber-400">≠</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t border-border font-medium">
                    <tr>
                      <td className="py-1.5">Total</td>
                      <td className="py-1.5 text-right tabular-nums">{brl.format(periodo.totalCa)}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {brl.format(periodo.totalJarvis)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {brl.format(periodo.totalJarvis - periodo.totalCa)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Meses com ✓ (Δ≈0) estão prontos pra virar. O cutover é único “a partir de” —
                  escolha o mês mais antigo em que você quer gerenciar no Jarvis a partir dali.
                </p>
              </div>
            ) : (
              <p className="px-3 py-3 text-center text-xs text-muted-foreground">
                {busy === "periodo"
                  ? "Lendo o Conta Azul e as parcelas…"
                  : periodo?.erro ?? "Clique em “Conferir período” para ver o Δ de cada mês."}
              </p>
            )}
          </div>

          {/* Passo 3 — cutover */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium">3 · Cutover da despesa</p>
              <p className="text-[11px] text-muted-foreground">
                A partir desta competência (inclusive), o DRE lê a despesa do Jarvis. Antes,
                do Conta Azul. Nunca conta as duas fontes no mesmo mês.
              </p>
            </div>
            <select
              className={cn(selectCls, "ml-auto")}
              disabled={busy !== null}
              value={cutover ?? ""}
              onChange={(e) => void mudarCutover(e.target.value)}
            >
              <option value="">Desligado (tudo do Conta Azul)</option>
              {ultimasCompetencias().map((m) => (
                <option key={m} value={m}>
                  A partir de {labelComp(m)}
                </option>
              ))}
            </select>
          </div>

          {msg && (
            <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              {msg}
            </p>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}
