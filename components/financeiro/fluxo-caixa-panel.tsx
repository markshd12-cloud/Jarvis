"use client";

import { useCallback, useEffect, useState } from "react";
import { IconArrowDown, IconArrowUp } from "@tabler/icons-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { BusinessUnit } from "@/lib/financeiro/types";
import type {
  FluxoCaixaResult,
  FluxoIncluir,
  FluxoModo,
} from "@/lib/financeiro/fluxo-caixa";

/**
 * Aba Fluxo de Caixa (Passo 13). Regime de CAIXA (data de pagamento/recebimento),
 * não competência. Entradas vêm do snapshot de receita; saídas das parcelas.
 * Filtros: mensal (ano) / diário (mês), BU e previsto/realizado/ambos. O acumulado
 * é do fluxo (parte de 0 — não é saldo bancário).
 */
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const selectCls =
  "h-8 rounded-lg border border-input bg-background px-2 text-sm outline-none [color-scheme:light] dark:[color-scheme:dark] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const anoAtual = new Date().getUTCFullYear();
const ANOS = [anoAtual + 1, anoAtual, anoAtual - 1, anoAtual - 2];

export function FluxoCaixaPanel() {
  const [modo, setModo] = useState<FluxoModo>("mensal");
  const [ano, setAno] = useState(anoAtual);
  const [mes, setMes] = useState(new Date().toISOString().slice(0, 7));
  const [incluir, setIncluir] = useState<FluxoIncluir>("ambos");
  const [buId, setBuId] = useState("");
  const [bus, setBus] = useState<BusinessUnit[]>([]);
  const [data, setData] = useState<FluxoCaixaResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/financeiro/bus")
      .then((r) => r.json())
      .then((j) => setBus((j.bus ?? []).filter((b: BusinessUnit) => b.ativo)))
      .catch(() => {});
  }, []);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ modo, incluir });
      if (modo === "mensal") qs.set("ano", String(ano));
      else qs.set("mes", mes);
      if (buId) qs.set("bu", buId);
      const j = await fetch(`/api/financeiro/fluxo-caixa?${qs}`).then((r) => r.json());
      if (j.error) throw new Error(j.error);
      setData(j as FluxoCaixaResult);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [modo, ano, mes, incluir, buId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const buckets = data?.buckets ?? [];
  const totais = data?.totais;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-sm font-semibold">Fluxo de Caixa</h2>
          <p className="text-xs text-muted-foreground">
            Regime de caixa (entra/sai por data de pagamento). O acumulado parte de zero — é o saldo do fluxo, não bancário.
          </p>
        </div>
        {data?.sincronizadoEm && (
          <span className="ml-auto text-[11px] text-muted-foreground">
            receita sincronizada em{" "}
            {new Date(data.sincronizadoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
        <select className={selectCls} value={modo} onChange={(e) => setModo(e.target.value as FluxoModo)}>
          <option value="mensal">Mensal (ano)</option>
          <option value="diario">Diário (mês)</option>
        </select>
        {modo === "mensal" ? (
          <select className={selectCls} value={ano} onChange={(e) => setAno(Number(e.target.value))}>
            {ANOS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        ) : (
          <Input type="month" className="h-8 w-40" value={mes} onChange={(e) => setMes(e.target.value)} />
        )}
        <select className={selectCls} value={buId} onChange={(e) => setBuId(e.target.value)}>
          <option value="">Todas as BUs</option>
          {bus.map((b) => (
            <option key={b.id} value={b.id}>
              {b.nome}
            </option>
          ))}
        </select>
        <select className={selectCls} value={incluir} onChange={(e) => setIncluir(e.target.value as FluxoIncluir)}>
          <option value="ambos">Previsto + Realizado</option>
          <option value="realizado">Só realizado</option>
          <option value="previsto">Só previsto</option>
        </select>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <>
          {totais && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div className="rounded-lg border border-border p-3">
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <IconArrowUp className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> Entradas
                </div>
                <div className="mt-1 text-lg font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {brl.format(totais.entrada)}
                </div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <IconArrowDown className="h-3.5 w-3.5 text-destructive" /> Saídas
                </div>
                <div className="mt-1 text-lg font-semibold tabular-nums text-destructive">
                  {brl.format(totais.saida)}
                </div>
              </div>
              <div className="col-span-2 rounded-lg border border-border p-3 sm:col-span-1">
                <div className="text-xs text-muted-foreground">Líquido do período</div>
                <div
                  className={cn(
                    "mt-1 text-lg font-semibold tabular-nums",
                    totais.liquido < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400",
                  )}
                >
                  {brl.format(totais.liquido)}
                </div>
              </div>
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">{modo === "mensal" ? "Mês" : "Dia"}</th>
                  <th className="px-3 py-2 text-right font-medium">Entradas</th>
                  <th className="px-3 py-2 text-right font-medium">Saídas</th>
                  <th className="px-3 py-2 text-right font-medium">Líquido</th>
                  <th className="px-3 py-2 text-right font-medium">Acumulado</th>
                </tr>
              </thead>
              <tbody>
                {buckets.map((b) => {
                  const vazio = b.entrada === 0 && b.saida === 0;
                  return (
                    <tr
                      key={b.chave}
                      className={cn("border-b border-border/60 last:border-0", vazio && "text-muted-foreground")}
                    >
                      <td className="px-3 py-1.5">{b.label}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {b.entrada ? brl.format(b.entrada) : "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {b.saida ? brl.format(b.saida) : "—"}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-1.5 text-right tabular-nums",
                          b.liquido < 0 && "text-destructive",
                          b.liquido > 0 && "text-emerald-600 dark:text-emerald-400",
                        )}
                      >
                        {b.liquido ? brl.format(b.liquido) : "—"}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-1.5 text-right font-medium tabular-nums",
                          b.acumulado < 0 && "text-destructive",
                        )}
                      >
                        {brl.format(b.acumulado)}
                      </td>
                    </tr>
                  );
                })}
                {buckets.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                      Sem dados no período.
                    </td>
                  </tr>
                )}
              </tbody>
              {totais && (
                <tfoot>
                  <tr className="border-t border-border text-xs font-medium">
                    <td className="px-3 py-2">Total</td>
                    <td className="px-3 py-2 text-right tabular-nums">{brl.format(totais.entrada)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{brl.format(totais.saida)}</td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right tabular-nums",
                        totais.liquido < 0 && "text-destructive",
                      )}
                    >
                      {brl.format(totais.liquido)}
                    </td>
                    <td className="px-3 py-2" />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}
    </section>
  );
}
