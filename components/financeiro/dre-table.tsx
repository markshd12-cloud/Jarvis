"use client";

import { useState, type ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";

import { MoneyInput } from "@/components/financeiro/money-input";
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

/**
 * Meta digitável DIRETO no DRE (folhas do Faturamento Bruto). Salva no blur em
 * `fin_orcamentos` (BU "Todas") — o mesmo lugar do Orçamento & Limite. O `key`
 * no ponto de uso remonta o campo quando o valor volta do refetch.
 */
function MetaCell({
  caId,
  competencia,
  initial,
  onSaved,
}: {
  caId: string;
  competencia: string;
  initial: number;
  onSaved: () => void;
}) {
  const [v, setV] = useState(initial ? String(Math.abs(initial)) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  const salvar = async () => {
    const num = Number(v) || 0;
    if (num === Math.abs(initial)) return; // sem mudança — não grava
    setBusy(true);
    setErr(false);
    try {
      const res = await fetch("/api/financeiro/dre/meta", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ca_categoria_id: caId, competencia, valor: num }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      onSaved();
    } catch {
      setErr(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="flex justify-end">
      <MoneyInput
        value={v}
        onChange={setV}
        onBlur={() => void salvar()}
        placeholder="meta…"
        disabled={busy}
        className={cn(
          "h-6 w-28 border-dashed text-right text-xs tabular-nums",
          err && "border-destructive",
        )}
      />
    </span>
  );
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
  temPrevReal = false,
  competencia,
  onMetaSaved,
}: {
  rows: DreRow[];
  loading?: boolean;
  connected?: boolean;
  atualizadoAte?: string | null;
  /** Fonte da despesa nesta competência (Passo 11): 'jarvis' pós-cutover. */
  despesaFonte?: "contaazul" | "jarvis";
  /** Há metas nesta competência? Só então as colunas Meta/Desvio aparecem. */
  temOrcamento?: boolean;
  /**
   * Fonte Jarvis com Previsto × Realizado de verdade (contas a pagar entram no
   * Previsto; ao pagar viram Realizado). false = modo CA, valor único (layout antigo).
   */
  temPrevReal?: boolean;
  /** Competência exibida ('AAAA-MM') — habilita digitar a Meta no Faturamento Bruto. */
  competencia?: string;
  /** Chamado após salvar uma meta digitada no DRE (pra recarregar). */
  onMetaSaved?: () => void;
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
  // Meta digitável no Faturamento Bruto exige a coluna Meta SEMPRE visível no
  // modo Jarvis (senão a 1ª meta não teria onde ser digitada).
  const podeEditarMeta = temPrevReal && !!competencia && !!onMetaSaved;
  const mostraMeta = temOrcamento || podeEditarMeta;
  // Layouts: modo CA (valor único) mantém os antigos; modo Previsto×Realizado
  // abre as duas colunas com seus AV%. Meta/Desvio quando há orçamento (ou edição).
  const cols = temPrevReal
    ? mostraMeta
      ? "grid-cols-[1fr_7.5rem_7.5rem_4rem_7.5rem_4rem_8rem]"
      : "grid-cols-[1fr_8rem_4.5rem_8rem_4.5rem]"
    : temOrcamento
      ? "grid-cols-[1fr_8rem_8rem_8.5rem_4.5rem]"
      : "grid-cols-[1fr_9rem_6rem]";

  /**
   * Células de valores de uma linha (tudo após "Categoria"), num layout só.
   * Desvio compara o PREVISTO (comprometido/emitido) com a Meta — o realizado
   * parcial do meio do mês enganaria (despesa ainda não paga pareceria "melhor").
   */
  const Cells = ({
    valor,
    previsto,
    avReal,
    avPrevisto,
    orcado,
    bold,
    small,
    metaEditor,
  }: {
    valor: number;
    previsto: number;
    avReal: number;
    avPrevisto: number;
    orcado: number;
    bold?: boolean;
    small?: boolean;
    /** Substitui a célula Meta por um editor (Faturamento Bruto no modo Jarvis). */
    metaEditor?: ReactNode;
  }) => {
    const txt = small ? "text-xs" : "text-sm";
    if (!temPrevReal) {
      // Layout antigo: [Meta?] Valor [Desvio?] AV%
      return (
        <>
          {temOrcamento ? (
            <span className={cn("text-right tabular-nums text-muted-foreground", txt)}>
              {orcado ? brl.format(orcado) : "—"}
            </span>
          ) : null}
          <span className="text-right">
            <Valor value={valor} bold={bold} />
          </span>
          {temOrcamento ? (
            <span className={cn("text-right", txt)}>
              <Desvio valor={valor} orcado={orcado} bold={bold} />
            </span>
          ) : null}
          <span className={cn("text-right text-muted-foreground", txt, bold && "font-semibold")}>
            {fmtAv(avReal)}
          </span>
        </>
      );
    }
    // Layout novo: [Meta?] Previsto AV% Realizado AV% [Desvio?]
    return (
      <>
        {mostraMeta ? (
          metaEditor ?? (
            <span className={cn("text-right tabular-nums text-muted-foreground", txt)}>
              {orcado ? brl.format(orcado) : "—"}
            </span>
          )
        ) : null}
        <span className="text-right">
          <Valor value={previsto} bold={bold} />
        </span>
        <span className={cn("text-right text-muted-foreground", txt, bold && "font-semibold")}>
          {fmtAv(avPrevisto)}
        </span>
        <span className="text-right">
          <Valor value={valor} bold={bold} />
        </span>
        <span className={cn("text-right text-muted-foreground", txt, bold && "font-semibold")}>
          {fmtAv(avReal)}
        </span>
        {mostraMeta ? (
          <span className={cn("text-right", txt)}>
            <Desvio valor={previsto} orcado={orcado} bold={bold} />
          </span>
        ) : null}
      </>
    );
  };

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
          <span className="ml-auto">
            {despesaFonte === "jarvis"
              ? "Receita: espelho do Conta Azul (sincronize na aba Receita)"
              : `Receita da Conta Azul${carimbo ? ` até ${carimbo}` : ""}`}
          </span>
        </div>
      ) : null}
      {!temOrcamento ? (
        <div className="border-b border-border bg-muted/20 px-4 py-1.5 text-[11px] text-muted-foreground">
          Sem metas nesta competência — cadastre em <strong>Orçamento &amp; Limite</strong> para
          ver as colunas <strong>Meta</strong> e <strong>Desvio</strong> aqui.
        </div>
      ) : null}
      <div
        className={cn(
          "grid items-center gap-2 border-b border-border bg-muted/50 px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground",
          cols,
        )}
      >
        <span>Categoria</span>
        {temPrevReal ? (
          <>
            {mostraMeta ? (
              <span className="text-right" title="Meta de faturamento (só receita)">
                Meta
              </span>
            ) : null}
            <span
              className="text-right"
              title="O custo/receita GERADO neste mês (competência) — pago ou não. É o resultado do mês."
            >
              Previsto
            </span>
            <span className="text-right">AV %</span>
            <span
              className="text-right"
              title="O que já foi pago/recebido destas linhas. Não é o Fluxo de Caixa."
            >
              Realizado
            </span>
            <span className="text-right">AV %</span>
            {mostraMeta ? <span className="text-right">Desvio</span> : null}
          </>
        ) : (
          <>
            {temOrcamento ? <span className="text-right">Meta</span> : null}
            <span className="text-right">{temOrcamento ? "Realizado" : "Valor"}</span>
            {temOrcamento ? <span className="text-right">Desvio</span> : null}
            <span className="text-right">AV %</span>
          </>
        )}
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
                <Cells
                  valor={row.valor}
                  previsto={row.previsto}
                  avReal={row.av}
                  avPrevisto={row.avPrev}
                  orcado={row.orcado}
                  bold
                />
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
                  "fin-row grid w-full items-center gap-2 px-4 py-2.5 text-left",
                  cols,
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
                <Cells
                  valor={row.valor}
                  previsto={row.previsto}
                  avReal={row.av}
                  avPrevisto={row.avPrev}
                  orcado={row.orcado}
                />
              </button>

              {isOpen && hasChildren
                ? row.children.map((leaf, i) => (
                    <div
                      key={`${row.codigo}-${i}`}
                      className={cn(
                        "fin-row grid items-center gap-2 bg-background/40 px-4 py-2 pl-11",
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
                      <Cells
                        valor={leaf.valor}
                        previsto={leaf.previsto}
                        avReal={leaf.av}
                        avPrevisto={leaf.avPrev}
                        orcado={leaf.orcado}
                        bold={leaf.sub}
                        small
                        metaEditor={
                          // EXCLUSIVO do Faturamento Bruto (grupo 01): meta digitável
                          // direto no DRE — grava no Orçamento & Limite (BU Todas).
                          podeEditarMeta && row.codigo === "01" && !leaf.sub && leaf.caId ? (
                            <MetaCell
                              key={`${leaf.caId}-${competencia}-${leaf.orcado}`}
                              caId={leaf.caId}
                              competencia={competencia!}
                              initial={leaf.orcado}
                              onSaved={onMetaSaved!}
                            />
                          ) : undefined
                        }
                      />
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
