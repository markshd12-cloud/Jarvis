"use client";

import { useCallback, useEffect, useState } from "react";
import { IconRefresh } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import type { ResumoReceita, SyncReceitaResult } from "@/lib/financeiro/receita";

/**
 * Aba Receita (Passo 10): snapshot da receita do Conta Azul no nosso banco. O botão
 * dispara o sync (idempotente, upsert por evento). Base do DRE v2 (Passo 11). Ainda
 * NÃO alimenta a aba DRE — que hoje lê direto do CA; a virada é o Passo 11.
 */
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function labelComp(ym: string): string {
  const [y, m] = ym.split("-");
  return `${m}/${y}`;
}
function fmtCarimbo(iso: string | null): string {
  if (!iso) return "nunca sincronizado";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

export function ReceitaPanel() {
  const [resumo, setResumo] = useState<ResumoReceita | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const j = await fetch("/api/financeiro/receita").then((r) => r.json());
      if (j.error) throw new Error(j.error);
      setResumo(j as ResumoReceita);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const sincronizar = async () => {
    setSyncing(true);
    setError(null);
    setAviso(null);
    try {
      const r: SyncReceitaResult = await fetch("/api/financeiro/receita/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ meses: 12 }),
      }).then((res) => res.json());
      if (!r.connected) {
        setError(r.erro ?? "Conta Azul indisponível.");
      } else {
        let msg = `${r.gravados} lançamento(s) gravado(s) de ${r.lidos} lido(s) (janela ${r.janela.de} → ${r.janela.ate}).`;
        if (r.semCategoria) msg += ` ${r.semCategoria} sem categoria mapeada.`;
        setAviso(msg);
        await refetch();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  const totalGeral = (resumo?.meses ?? []).reduce((s, m) => s + m.total, 0);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div>
          <h2 className="text-sm font-semibold">Receita (snapshot do Conta Azul)</h2>
          <p className="text-xs text-muted-foreground">
            Sincronizado em: {fmtCarimbo(resumo?.sincronizadoEm ?? null)}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => void sincronizar()}
          disabled={syncing}
        >
          <IconRefresh className={syncing ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          {syncing ? "Sincronizando…" : "Sincronizar do Conta Azul"}
        </Button>
      </div>

      <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
        Este snapshot é a base do DRE definitivo (Passo 11). Ainda não alimenta a aba DRE
        — que hoje lê direto do Conta Azul. A virada acontece no próximo passo.
      </p>

      {aviso && (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {aviso}
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Competência</th>
              <th className="px-3 py-2 text-right font-medium">Receita</th>
              <th className="px-3 py-2 text-right font-medium">Recebido</th>
            </tr>
          </thead>
          <tbody>
            {(resumo?.meses ?? []).map((m) => (
              <tr key={m.competencia} className="border-b border-border last:border-0">
                <td className="px-3 py-2">{labelComp(m.competencia)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{brl.format(m.total)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {brl.format(m.recebido)}
                </td>
              </tr>
            ))}
            {(resumo?.meses ?? []).length === 0 && !loading && (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">
                  Snapshot vazio — clique em “Sincronizar do Conta Azul”.
                </td>
              </tr>
            )}
          </tbody>
          {(resumo?.meses ?? []).length > 0 && (
            <tfoot className="border-t border-border font-medium">
              <tr>
                <td className="px-3 py-2">Total</td>
                <td className="px-3 py-2 text-right tabular-nums">{brl.format(totalGeral)}</td>
                <td className="px-3 py-2" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}
