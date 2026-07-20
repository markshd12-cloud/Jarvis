"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  IconRefresh,
  IconChevronLeft,
  IconChevronRight,
  IconSearch,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import type { InadimplentesResult } from "@/lib/financeiro/inadimplentes";

/** Opções de tamanho de página (clientes por página). */
const PAGE_SIZES = [20, 50, 100, 500] as const;

/**
 * Aba Inadimplentes: contas a receber vencidas do Conta Azul, agrupadas por
 * cliente (espelha a tela "Inadimplentes" do CA). Só leitura. O total bate com
 * `totais.vencido` da API. Gated no server por `financeiro`.
 */
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** 'AAAA-MM-DD' → 'DD/MM/AAAA' (sem Date, evita fuso). */
function fmtData(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

function fmtCarimbo(iso: string): string {
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

export function InadimplentesPanel() {
  const [data, setData] = useState<InadimplentesResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [pageSize, setPageSize] = useState<number>(20);
  const [page, setPage] = useState(1);

  const refetch = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const url = force
        ? "/api/financeiro/inadimplentes?fresh=1"
        : "/api/financeiro/inadimplentes";
      const j = (await fetch(url).then((r) => r.json())) as
        | InadimplentesResult
        | { error: string };
      if ("error" in j) throw new Error(j.error);
      setData(j);
    } catch {
      setData({
        connected: false,
        total: 0,
        totalApi: 0,
        registros: 0,
        clientes: [],
        atualizadoEm: new Date().toISOString(),
        erro: "Não foi possível carregar os inadimplentes.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const clientes = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const lista = data?.clientes ?? [];
    return q ? lista.filter((c) => c.cliente.toLowerCase().includes(q)) : lista;
  }, [data, busca]);

  const totalPages = Math.max(1, Math.ceil(clientes.length / pageSize));
  const pageClamped = Math.min(page, totalPages);
  const clientesPagina = clientes.slice(
    (pageClamped - 1) * pageSize,
    pageClamped * pageSize,
  );

  const toggle = (nome: string) =>
    setAbertos((prev) => {
      const next = new Set(prev);
      if (next.has(nome)) next.delete(nome);
      else next.add(nome);
      return next;
    });

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-sm font-semibold">Inadimplentes (Conta Azul)</h2>
          <p className="text-xs text-muted-foreground">
            Contas a receber vencidas e em aberto · atualizado em{" "}
            {data ? fmtCarimbo(data.atualizadoEm) : "…"}
          </p>
        </div>
        <div className="ml-auto text-right">
          <p className="text-xs text-muted-foreground">Total em aberto (vencido)</p>
          <p className="text-lg font-semibold tabular-nums text-destructive">
            {brl.format(data?.total ?? 0)}
          </p>
          <p className="text-xs text-muted-foreground">
            {data?.registros ?? 0} lançamento(s) · {data?.clientes.length ?? 0} cliente(s)
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refetch(true)}
          disabled={loading}
          title="Busca ao vivo no Conta Azul (ignora o cache de 5 min)"
        >
          <IconRefresh className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          Atualizar
        </Button>
      </div>

      {/* Busca por nome do cliente (igual ao CA) */}
      <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
        <IconSearch className="h-4 w-4 text-muted-foreground" />
        <input
          value={busca}
          onChange={(e) => {
            setBusca(e.target.value);
            setPage(1);
          }}
          placeholder="Pesquisar pelo nome do cliente"
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      {data && !data.connected && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          {data.erro ?? "Conta Azul desconectada."}
        </p>
      )}

      {loading && !data && (
        <p className="px-3 py-6 text-center text-sm text-muted-foreground">Carregando…</p>
      )}

      {data?.connected && clientes.length === 0 && !loading && (
        <p className="px-3 py-6 text-center text-sm text-muted-foreground">
          {busca ? "Nenhum cliente com esse nome." : "Nenhum inadimplente. 🎉"}
        </p>
      )}

      {data?.connected && clientes.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Por página:</span>
            {PAGE_SIZES.map((n) => (
              <Button
                key={n}
                variant={pageSize === n ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setPageSize(n);
                  setPage(1);
                }}
              >
                {n}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs tabular-nums text-muted-foreground">
              {(pageClamped - 1) * pageSize + 1}–
              {Math.min(pageClamped * pageSize, clientes.length)} de {clientes.length}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={pageClamped <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <IconChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs tabular-nums">
              {pageClamped}/{totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={pageClamped >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              <IconChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {clientesPagina.map((c) => {
          const aberto = abertos.has(c.cliente);
          return (
            <div key={c.cliente} className="overflow-hidden rounded-lg border border-border">
              <button
                type="button"
                onClick={() => toggle(c.cliente)}
                className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-muted/40"
              >
                <IconChevronRight
                  className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                    aberto ? "rotate-90" : ""
                  }`}
                />
                <span className="font-medium">{c.cliente}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {c.itens.length}
                </span>
                <span className="ml-auto text-sm font-semibold tabular-nums text-destructive">
                  {brl.format(c.total)}
                </span>
              </button>

              {aberto && (
                <div className="overflow-x-auto border-t border-border">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">Descrição</th>
                        <th className="px-3 py-2 font-medium">Vencimento</th>
                        <th className="px-3 py-2 text-right font-medium">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.itens.map((it) => (
                        <tr key={it.id || it.descricao} className="border-t border-border">
                          <td className="px-3 py-2">{it.descricao}</td>
                          <td className="px-3 py-2 tabular-nums">{fmtData(it.vencimento)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {brl.format(it.valor)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
