"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { IconRefresh } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CentrosCustoResumo } from "@/lib/financeiro/centros-custo";

/**
 * Aba "% por Centro de Custo" (Passo 14): distribuição da despesa por centro de
 * custo no ano, previsto × realizado e % do total, com barra de distribuição.
 * Fonte = Conta Azul ao vivo (cache 5 min; "Atualizar" fura o cache). Gated por
 * `financeiro` no server.
 */
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

type Base = "realizado" | "previsto";

function anosDisponiveis(): number[] {
  const y = new Date().getFullYear();
  return [y, y - 1, y - 2, y - 3];
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

export function CentroCustoPanel() {
  const [ano, setAno] = useState<number>(() => new Date().getFullYear());
  const [base, setBase] = useState<Base>("realizado");
  const [data, setData] = useState<CentrosCustoResumo | null>(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(
    async (force = false) => {
      setLoading(true);
      try {
        const qs = new URLSearchParams({ ano: String(ano) });
        if (force) qs.set("fresh", "1");
        const j = (await fetch(`/api/financeiro/centros-custo?${qs}`).then((r) => r.json())) as
          | CentrosCustoResumo
          | { error: string };
        if ("error" in j) throw new Error(j.error);
        setData(j);
      } catch {
        setData({
          connected: false,
          ano,
          linhas: [],
          porMes: [],
          totais: { previsto: 0, realizado: 0 },
          atualizadoEm: new Date().toISOString(),
          erro: "Não foi possível carregar.",
        });
      } finally {
        setLoading(false);
      }
    },
    [ano],
  );

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const totalBase = data?.totais[base] ?? 0;
  const linhas = useMemo(() => {
    const ls = [...(data?.linhas ?? [])];
    ls.sort((a, b) => b[base] - a[base]);
    return ls;
  }, [data, base]);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-sm font-semibold">% por Centro de Custo</h2>
          <p className="text-xs text-muted-foreground">
            Distribuição da despesa (contas a pagar do Conta Azul) por centro no ano
            {data ? ` · atualizado ${fmtCarimbo(data.atualizadoEm)}` : ""}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => void refetch(true)}
          disabled={loading}
          title="Busca ao vivo no Conta Azul (ignora o cache de 5 min)"
        >
          <IconRefresh className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          Atualizar
        </Button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
            Ano: {ano}
            <ChevronDownIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {anosDisponiveis().map((a) => (
              <DropdownMenuItem key={a} onClick={() => setAno(a)}>
                {a}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex items-center gap-1">
          <Button
            variant={base === "realizado" ? "default" : "outline"}
            size="sm"
            onClick={() => setBase("realizado")}
          >
            Realizado
          </Button>
          <Button
            variant={base === "previsto" ? "default" : "outline"}
            size="sm"
            onClick={() => setBase("previsto")}
          >
            Previsto
          </Button>
        </div>
      </div>

      {data && !data.connected && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          {data.erro ?? "Conta Azul desconectada."}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Centro de Custo</th>
              <th className="px-3 py-2 text-right font-medium">Previsto</th>
              <th className="px-3 py-2 text-right font-medium">Realizado</th>
              <th className="px-3 py-2 text-right font-medium">
                % ({base === "realizado" ? "realizado" : "previsto"})
              </th>
              <th className="px-3 py-2 font-medium">Distribuição</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => {
              const pct = totalBase > 0 ? (l[base] / totalBase) * 100 : 0;
              return (
                <tr key={l.centroId ?? "__sem__"} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">{l.centro}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {brl.format(l.previsto)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{brl.format(l.realizado)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{pct.toFixed(1)}%</td>
                  <td className="px-3 py-2">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
            {linhas.length === 0 && !loading && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                  {data?.connected ? "Nenhuma despesa no período." : "Sem dados."}
                </td>
              </tr>
            )}
          </tbody>
          {linhas.length > 0 && (
            <tfoot className="border-t border-border font-medium">
              <tr>
                <td className="px-3 py-2">Total</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {brl.format(data?.totais.previsto ?? 0)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {brl.format(data?.totais.realizado ?? 0)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">100%</td>
                <td className="px-3 py-2" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}
