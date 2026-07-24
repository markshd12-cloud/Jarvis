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

/**
 * Desvio = Realizado − Orçado, já na convenção de sinal do DRE (receita +,
 * despesa −). Por isso a leitura é a MESMA dos dois lados: **positivo = melhor
 * que o planejado** (faturou mais OU gastou menos). Sem meta lançada → "—".
 */
function Desvio({ valor, orcado, bold }: { valor: number; orcado: number; bold?: boolean }) {
  if (orcado === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const d = valor - orcado;
  const pct = (d / Math.abs(orcado)) * 100;
  const bom = d >= 0;
  return (
    <span
      className={cn(
        "tabular-nums",
        bold && "font-semibold",
        bom ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400",
      )}
      title={bom ? "Melhor que o planejado" : "Pior que o planejado"}
    >
      {d > 0 ? "+" : ""}
      {brl.format(d)}
      <span className="block text-[10px] font-normal opacity-80">
        {pct > 0 ? "+" : ""}
        {pct.toFixed(1).replace(".", ",")}%
      </span>
    </span>
  );
}

export function DreTable({
  rows,
  loading,
  connected = true,
  atualizadoAte,
  despesaFonte = "contaazul",
  temOrcamento = false,
}: {
  rows: DreRow[];
  loading?: boolean;
  connected?: boolean;
  atualizadoAte?: string | null;
  /** Fonte da despesa nesta competência (Passo 11): 'jarvis' pós-cutover. */
  despesaFonte?: "contaazul" | "jarvis";
  /** Há metas nesta competência? Só então as colunas Orçado/Desvio aparecem. */
  temOrcamento?: boolean;
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
  // Sem metas: mantém o layout de 3 colunas de sempre (uma coluna de zeros
  // pareceria "orçamos R$ 0"). Com metas: abre Orçado e Desvio.
  const cols = temOrcamento
    ? "grid-cols-[1fr_8rem_8rem_8.5rem_4.5rem]"
    : "grid-cols-[1fr_9rem_6rem]";

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {carimbo || despesaFonte === "jarvis" ? (
        <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-1.5 text-[11px] text-muted-foreground">
          <span
            className={
              despesaFonte === "jarvis"
                ? "rounded bg-emerald-500/10 px-1.5 py-0.5 font-medium text-emerald-600 dark:text-emerald-400"
                : "rounded bg-muted px-1.5 py-0.5 font-medium"
            }
          >
            Despesa: {despesaFonte === "jarvis" ? "Jarvis (nossas parcelas)" : "Conta Azul"}
          </span>
          <span className="ml-auto">Receita da Conta Azul{carimbo ? ` até ${carimbo}` : ""}</span>
        </div>
      ) : null}
      {!temOrcamento ? (
        <div className="border-b border-border bg-muted/20 px-4 py-1.5 text-[11px] text-muted-foreground">
          Sem metas nesta competência — cadastre em <strong>Orçamento &amp; Limite</strong> para
          ver as colunas <strong>Orçado</strong> e <strong>Desvio</strong> aqui.
        </div>
      ) : null}
      <div
        className={cn(
          "grid items-center gap-2 border-b border-border bg-muted/50 px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground",
          cols,
        )}
      >
        <span>Categoria</span>
        {temOrcamento ? <span className="text-right">Orçado</span> : null}
        <span className="text-right">{temOrcamento ? "Realizado" : "Valor"}</span>
        {temOrcamento ? <span className="text-right">Desvio</span> : null}
        <span className="text-right">AV %</span>
      </div>

      <div className="divide-y divide-border/60">
        {rows.map((row, idx) => {
          if (row.kind === "subtotal") {
            return (
              <div
                key={`t-${idx}`}
                className={cn("grid items-center gap-2 bg-muted/40 px-4 py-2.5", cols)}
              >
                <span className="text-sm font-semibold text-foreground">
                  {row.label}
                </span>
                {temOrcamento ? (
                  <span className="text-right text-sm text-muted-foreground tabular-nums">
                    {row.orcado ? brl.format(row.orcado) : "—"}
                  </span>
                ) : null}
                <span className="text-right">
                  <Valor value={row.valor} bold />
                </span>
                {temOrcamento ? (
                  <span className="text-right text-sm">
                    <Desvio valor={row.valor} orcado={row.orcado} bold />
                  </span>
                ) : null}
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
                  "grid w-full items-center gap-2 px-4 py-2.5 text-left",
                  cols,
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
                {temOrcamento ? (
                  <span className="text-right text-sm text-muted-foreground tabular-nums">
                    {row.orcado ? brl.format(row.orcado) : "—"}
                  </span>
                ) : null}
                <span className="text-right">
                  <Valor value={row.valor} />
                </span>
                {temOrcamento ? (
                  <span className="text-right text-sm">
                    <Desvio valor={row.valor} orcado={row.orcado} />
                  </span>
                ) : null}
                <span className="text-right text-sm text-muted-foreground">
                  {fmtAv(row.av)}
                </span>
              </button>

              {isOpen && hasChildren
                ? row.children.map((leaf, i) => (
                    <div
                      key={`${row.codigo}-${i}`}
                      className={cn(
                        "grid items-center gap-2 bg-background/40 px-4 py-2 pl-11",
                        cols,
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
                      {temOrcamento ? (
                        <span className="text-right text-xs text-muted-foreground tabular-nums">
                          {leaf.orcado ? brl.format(leaf.orcado) : "—"}
                        </span>
                      ) : null}
                      <span className="text-right text-sm">
                        <Valor value={leaf.valor} bold={leaf.sub} />
                      </span>
                      {temOrcamento ? (
                        <span className="text-right text-xs">
                          <Desvio valor={leaf.valor} orcado={leaf.orcado} bold={leaf.sub} />
                        </span>
                      ) : null}
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
