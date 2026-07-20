"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import {
  IconRefresh,
  IconChevronLeft,
  IconChevronRight,
  IconSearch,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { VendasResumo } from "@/lib/financeiro/vendas";

/**
 * Aba "Vendas & Contas a Faturar" (Passo 15): vendas do ano lidas do Conta Azul,
 * separando FATURADO (NF emitida) de A FATURAR (aprovada, sem NF). Fonte = CA ao
 * vivo (cache 5 min; "Atualizar" fura). Gated por `financeiro` no server.
 */
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const PAGE_SIZES = [20, 50, 100, 500] as const;
type Filtro = "todas" | "faturadas" | "afaturar";

function anosDisponiveis(): number[] {
  const y = new Date().getFullYear();
  return [y, y - 1, y - 2, y - 3];
}
function fmtData(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso || "—";
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
function tipoLabel(t: string): string {
  if (t === "PRODUCT") return "Produto";
  if (t === "SERVICE") return "Serviço";
  return t || "—";
}

export function VendasPanel() {
  const [ano, setAno] = useState<number>(() => new Date().getFullYear());
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [busca, setBusca] = useState("");
  const [pageSize, setPageSize] = useState<number>(50);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<VendasResumo | null>(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(
    async (force = false) => {
      setLoading(true);
      try {
        const qs = new URLSearchParams({ ano: String(ano) });
        if (force) qs.set("fresh", "1");
        const j = (await fetch(`/api/financeiro/vendas?${qs}`).then((r) => r.json())) as
          | VendasResumo
          | { error: string };
        if ("error" in j) throw new Error(j.error);
        setData(j);
      } catch {
        setData({
          connected: false,
          ano,
          vendas: [],
          totais: { total: 0, faturado: 0, aFaturar: 0, qtd: 0, qtdFaturado: 0, qtdAFaturar: 0 },
          atualizadoEm: new Date().toISOString(),
          erro: "Não foi possível carregar as vendas.",
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

  const vendas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    let lista = data?.vendas ?? [];
    if (filtro === "faturadas") lista = lista.filter((v) => v.faturado);
    else if (filtro === "afaturar")
      lista = lista.filter((v) => !v.faturado && v.situacao !== "CANCELADO");
    if (q) lista = lista.filter((v) => v.cliente.toLowerCase().includes(q));
    return lista;
  }, [data, filtro, busca]);

  const totalPages = Math.max(1, Math.ceil(vendas.length / pageSize));
  const pageClamped = Math.min(page, totalPages);
  const vendasPagina = vendas.slice((pageClamped - 1) * pageSize, pageClamped * pageSize);

  const t = data?.totais;

  const filtros: { key: Filtro; label: string; qtd: number | undefined }[] = [
    { key: "todas", label: "Todas", qtd: t?.qtd },
    { key: "faturadas", label: "Faturadas", qtd: t?.qtdFaturado },
    { key: "afaturar", label: "A Faturar", qtd: t?.qtdAFaturar },
  ];

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-sm font-semibold">Vendas & Contas a Faturar</h2>
          <p className="text-xs text-muted-foreground">
            Vendas do Conta Azul no ano · FATURADO (NF) × A FATURAR (aprovada)
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

      {/* Cards de total */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-border px-3 py-2">
          <p className="text-xs text-muted-foreground">Total vendido ({ano})</p>
          <p className="text-lg font-semibold tabular-nums">{brl.format(t?.total ?? 0)}</p>
        </div>
        <div
          className="cursor-help rounded-lg border border-border px-3 py-2"
          title="Vendas com Nota Fiscal já emitida."
        >
          <p className="text-xs text-muted-foreground">Faturado (NF emitida)</p>
          <p className="text-lg font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
            {brl.format(t?.faturado ?? 0)}
          </p>
        </div>
        <div
          className="cursor-help rounded-lg border border-border px-3 py-2"
          title="Vendas aprovadas cuja Nota Fiscal ainda NÃO foi emitida — pendentes de faturar. Não confundir com 'a receber' (entrada de dinheiro)."
        >
          <p className="text-xs text-muted-foreground">A faturar (contas a faturar)</p>
          <p className="text-lg font-semibold tabular-nums text-amber-600 dark:text-amber-400">
            {brl.format(t?.aFaturar ?? 0)}
          </p>
        </div>
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
      {vendas.length > 0 && (
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
              {Math.min(pageClamped * pageSize, vendas.length)} de {vendas.length}
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
              <th className="px-3 py-2 font-medium">Nº</th>
              <th className="px-3 py-2 font-medium">Data</th>
              <th className="px-3 py-2 font-medium">Cliente</th>
              <th className="px-3 py-2 font-medium">Tipo</th>
              <th className="px-3 py-2 font-medium">Situação</th>
              <th className="px-3 py-2 text-right font-medium">Valor</th>
            </tr>
          </thead>
          <tbody>
            {vendasPagina.map((v) => (
              <tr key={v.id || `${v.numero}-${v.data}`} className="border-b border-border last:border-0">
                <td className="px-3 py-2 tabular-nums text-muted-foreground">{v.numero ?? "—"}</td>
                <td className="px-3 py-2 tabular-nums">{fmtData(v.data)}</td>
                <td className="px-3 py-2">{v.cliente}</td>
                <td className="px-3 py-2 text-muted-foreground">{tipoLabel(v.tipoItem)}</td>
                <td className="px-3 py-2">
                  <span
                    className={
                      v.faturado
                        ? "rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-400"
                        : "rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-400"
                    }
                  >
                    {v.situacaoLabel}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{brl.format(v.total)}</td>
              </tr>
            ))}
            {vendas.length === 0 && !loading && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  {data?.connected ? "Nenhuma venda no período." : "Sem dados."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
