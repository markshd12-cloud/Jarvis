"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  IconRefresh,
  IconChevronLeft,
  IconChevronRight,
  IconSearch,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import type { ClientesResumo } from "@/lib/financeiro/clientes";

/**
 * Aba "Clientes" (Passo 16): visão de cliente composta do Conta Azul — LTV
 * (Σ vendas), em aberto/vencido (contas a receber) e situação (adimplente ×
 * inadimplente). Só leitura, gated por `financeiro` no server. Cache 10 min.
 */
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const PAGE_SIZES = [20, 50, 100, 500] as const;
type Filtro = "todos" | "adimplentes" | "inadimplentes";

function fmtData(iso: string | null): string {
  if (!iso) return "—";
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
        hour: "2-digit",
        minute: "2-digit",
      });
}

export function ClientesPanel() {
  const [data, setData] = useState<ClientesResumo | null>(null);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [busca, setBusca] = useState("");
  const [pageSize, setPageSize] = useState<number>(50);
  const [page, setPage] = useState(1);

  const refetch = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const url = force
        ? "/api/financeiro/clientes?fresh=1"
        : "/api/financeiro/clientes";
      const j = (await fetch(url).then((r) => r.json())) as
        | ClientesResumo
        | { error: string };
      if ("error" in j) throw new Error(j.error);
      setData(j);
    } catch {
      setData({
        connected: false,
        clientes: [],
        totais: { qtd: 0, inadimplentes: 0, ltv: 0, emAberto: 0, vencido: 0 },
        atualizadoEm: new Date().toISOString(),
        erro: "Não foi possível carregar os clientes.",
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
    let lista = data?.clientes ?? [];
    if (filtro === "adimplentes") lista = lista.filter((c) => c.situacao === "adimplente");
    else if (filtro === "inadimplentes")
      lista = lista.filter((c) => c.situacao === "inadimplente");
    if (q) lista = lista.filter((c) => c.nome.toLowerCase().includes(q));
    return lista;
  }, [data, filtro, busca]);

  const totalPages = Math.max(1, Math.ceil(clientes.length / pageSize));
  const pageClamped = Math.min(page, totalPages);
  const clientesPagina = clientes.slice((pageClamped - 1) * pageSize, pageClamped * pageSize);

  const t = data?.totais;
  const filtros: { key: Filtro; label: string; qtd: number | undefined }[] = [
    { key: "todos", label: "Todos", qtd: t?.qtd },
    { key: "adimplentes", label: "Adimplentes", qtd: t ? t.qtd - t.inadimplentes : undefined },
    { key: "inadimplentes", label: "Inadimplentes", qtd: t?.inadimplentes },
  ];

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-sm font-semibold">Clientes</h2>
          <p className="text-xs text-muted-foreground">
            LTV, em aberto e situação (Conta Azul)
            {data ? ` · atualizado ${fmtCarimbo(data.atualizadoEm)}` : ""}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => void refetch(true)}
          disabled={loading}
          title="Busca ao vivo no Conta Azul (ignora o cache de 10 min)"
        >
          <IconRefresh className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          Atualizar
        </Button>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg border border-border px-3 py-2">
          <p className="text-xs text-muted-foreground">Clientes</p>
          <p className="text-lg font-semibold tabular-nums">{t?.qtd ?? 0}</p>
        </div>
        <div className="rounded-lg border border-border px-3 py-2">
          <p className="text-xs text-muted-foreground">Inadimplentes</p>
          <p className="text-lg font-semibold tabular-nums text-destructive">
            {t?.inadimplentes ?? 0}
          </p>
        </div>
        <div className="rounded-lg border border-border px-3 py-2">
          <p className="text-xs text-muted-foreground">LTV total (vendas)</p>
          <p className="text-lg font-semibold tabular-nums">{brl.format(t?.ltv ?? 0)}</p>
        </div>
        <div className="rounded-lg border border-border px-3 py-2">
          <p className="text-xs text-muted-foreground">Em aberto (vencido)</p>
          <p className="text-lg font-semibold tabular-nums text-amber-600 dark:text-amber-400">
            {brl.format(t?.emAberto ?? 0)}
          </p>
          <p className="text-xs tabular-nums text-destructive">{brl.format(t?.vencido ?? 0)} vencido</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          {filtros.map((f) => (
            <Button
              key={f.key}
              variant={filtro === f.key ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setFiltro(f.key);
                setPage(1);
              }}
            >
              {f.label}
              {f.qtd != null ? ` (${f.qtd})` : ""}
            </Button>
          ))}
        </div>
        <div className="flex min-w-50 flex-1 items-center gap-2 rounded-lg border border-border px-3 py-1.5">
          <IconSearch className="h-4 w-4 text-muted-foreground" />
          <input
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              setPage(1);
            }}
            placeholder="Buscar cliente"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {data && !data.connected && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          {data.erro ?? "Conta Azul desconectada."}
        </p>
      )}

      {/* Paginação */}
      {clientes.length > 0 && (
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

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Cliente</th>
              <th className="px-3 py-2 text-right font-medium">LTV</th>
              <th className="px-3 py-2 text-right font-medium">Em aberto</th>
              <th className="px-3 py-2 text-right font-medium">Vencido</th>
              <th className="px-3 py-2 font-medium">Situação</th>
              <th className="px-3 py-2 text-right font-medium">Última compra</th>
            </tr>
          </thead>
          <tbody>
            {clientesPagina.map((c) => (
              <tr key={c.id ?? c.nome} className="border-b border-border last:border-0">
                <td className="px-3 py-2">{c.nome}</td>
                <td className="px-3 py-2 text-right tabular-nums">{brl.format(c.ltv)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {brl.format(c.emAberto)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {c.vencido > 0 ? (
                    <span className="text-destructive">{brl.format(c.vencido)}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={
                      c.situacao === "inadimplente"
                        ? "rounded-full bg-destructive/15 px-2 py-0.5 text-xs text-destructive"
                        : "rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-400"
                    }
                  >
                    {c.situacao === "inadimplente" ? "Inadimplente" : "Adimplente"}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {fmtData(c.ultimaCompra)}
                </td>
              </tr>
            ))}
            {clientes.length === 0 && !loading && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  {data?.connected ? "Nenhum cliente." : "Sem dados."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
