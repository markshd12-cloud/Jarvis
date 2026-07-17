"use client";

import { useState } from "react";
import { ChevronRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { DreRow } from "@/lib/contaazul/dre";

/**
 * Tabela do DRE Gerencial. Espelha a estrutura do relatório do Conta Azul:
 * grupos numerados (01…08), subgrupos (03.1/03.2), folhas e linhas de subtotal.
 * Colunas: Categoria | Valor | AV% (análise vertical sobre a Receita Bruta).
 * Recebe as linhas já calculadas (`lib/contaazul/dre.ts`).
 */
const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function fmtAv(av: number): string {
  return `${av.toFixed(2).replace(".", ",")}%`;
}

/** Carimbo de frescor dos dados da CA (data + hora curtas), ou null se inválido. */
function fmtCarimbo(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Valor({ value, bold }: { value: number; bold?: boolean }) {
  return (
    <span
      className={cn(
        "tabular-nums",
        bold && "font-semibold",
        value < 0 ? "text-red-500 dark:text-red-400" : "text-foreground",
      )}
    >
      {brl.format(value)}
    </span>
  );
}

export function DreTable({
  rows,
  loading,
  connected = true,
  atualizadoAte,
}: {
  rows: DreRow[];
  loading?: boolean;
  connected?: boolean;
  atualizadoAte?: string | null;
}) {
  // Grupos expandidos (por código). 03 (Custos) começa aberto, como na referência.
  const [open, setOpen] = useState<Set<string>>(new Set(["03"]));
  const toggle = (code: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl border border-border bg-card text-sm text-muted-foreground">
        Carregando DRE…
      </div>
    );
  }
  if (!connected) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl border border-border bg-card text-sm text-muted-foreground">
        Conta Azul desconectada ou sem dados para o período.
      </div>
    );
  }

  const carimbo = atualizadoAte ? fmtCarimbo(atualizadoAte) : null;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {carimbo ? (
        <div className="border-b border-border bg-muted/30 px-4 py-1.5 text-right text-[11px] text-muted-foreground">
          Dados da Conta Azul até {carimbo}
        </div>
      ) : null}
      <div className="grid grid-cols-[1fr_9rem_6rem] items-center gap-2 border-b border-border bg-muted/50 px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <span>Categoria</span>
        <span className="text-right">Valor</span>
        <span className="text-right">AV %</span>
      </div>

      <div className="divide-y divide-border/60">
        {rows.map((row, idx) => {
          if (row.kind === "subtotal") {
            return (
              <div
                key={`t-${idx}`}
                className="grid grid-cols-[1fr_9rem_6rem] items-center gap-2 bg-muted/40 px-4 py-2.5"
              >
                <span className="text-sm font-semibold text-foreground">
                  {row.label}
                </span>
                <span className="text-right">
                  <Valor value={row.valor} bold />
                </span>
                <span className="text-right text-sm font-semibold text-muted-foreground">
                  {fmtAv(row.av)}
                </span>
              </div>
            );
          }

          const isOpen = open.has(row.codigo);
          const hasChildren = row.children.length > 0;
          return (
            <div key={`g-${row.codigo}-${idx}`}>
              <button
                type="button"
                onClick={() => hasChildren && toggle(row.codigo)}
                className={cn(
                  "grid w-full grid-cols-[1fr_9rem_6rem] items-center gap-2 px-4 py-2.5 text-left",
                  hasChildren && "hover:bg-muted/30",
                )}
              >
                <span className="flex items-center gap-1.5 text-sm text-foreground">
                  {hasChildren ? (
                    <ChevronRightIcon
                      className={cn(
                        "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                        isOpen && "rotate-90",
                      )}
                    />
                  ) : (
                    <span className="w-3.5" />
                  )}
                  <span className="text-xs text-muted-foreground">{row.codigo}</span>
                  <span>{row.label}</span>
                </span>
                <span className="text-right">
                  <Valor value={row.valor} />
                </span>
                <span className="text-right text-sm text-muted-foreground">
                  {fmtAv(row.av)}
                </span>
              </button>

              {isOpen && hasChildren
                ? row.children.map((leaf, i) => (
                    <div
                      key={`${row.codigo}-${i}`}
                      className={cn(
                        "grid grid-cols-[1fr_9rem_6rem] items-center gap-2 bg-background/40 px-4 py-2 pl-11",
                        leaf.sub && "bg-muted/20",
                      )}
                    >
                      <span
                        className={cn(
                          "text-sm text-muted-foreground",
                          leaf.sub && "font-medium text-foreground",
                        )}
                      >
                        {leaf.label}
                      </span>
                      <span className="text-right text-sm">
                        <Valor value={leaf.valor} bold={leaf.sub} />
                      </span>
                      <span className="text-right text-xs text-muted-foreground">
                        {fmtAv(leaf.av)}
                      </span>
                    </div>
                  ))
                : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
