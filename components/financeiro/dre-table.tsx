"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MoneyInput } from "@/components/financeiro/money-input";
import { cn } from "@/lib/utils";
import type { DreDetalheItem, DreRow } from "@/lib/contaazul/dre";

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

/**
 * Respiro à direita de uma coluna, para separar GRUPOS de colunas que contam
 * histórias diferentes (Meta × Realizado; Previsto+AV × Realizado+AV).
 *
 * Precisa ser a MESMA constante no cabeçalho, na célula e no editor de meta —
 * quando cada um tinha o seu, o título saía de cima do número.
 */
const PAD_GRUPO = "pr-6";


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
  buId,
  initial,
  onSaved,
}: {
  caId: string;
  competencia: string;
  /** BU do DRE aberto — a meta grava nela, senão some ao recarregar. */
  buId: string | null;
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
        body: JSON.stringify({
          ca_categoria_id: caId,
          competencia,
          valor: num,
          bu_id: buId,
        }),
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
    // Mesmo padding da célula de leitura, senão o campo desalinha da coluna.
    <span className={cn("flex justify-end", PAD_GRUPO)}>
      <MoneyInput
        value={v}
        onChange={setV}
        onBlur={() => void salvar()}
        // Enter = confirmar. Sem isto o evento escapava para o navegador (submit
        // do formulário ancestral), a página recarregava antes do save terminar
        // e o valor digitado se perdia. `blur()` dispara o mesmo caminho de save.
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          e.currentTarget.blur();
        }}
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
function Desvio({
  valor,
  orcado,
  temMeta,
  bold,
}: {
  valor: number;
  orcado: number;
  /** Sem meta cadastrada não há desvio a calcular. Meta ZERO tem. */
  temMeta: boolean;
  bold?: boolean;
}) {
  if (!temMeta) {
    return <span className="text-xs text-muted-foreground/50">—</span>;
  }
  // Meta zero é alvo real ("não gastar aqui"): o desvio é o próprio realizado, e
  // qualquer gasto é estouro. Sem o `temMeta` acima isso cairia no "—".
  if (orcado === 0) {
    const d = valor;
    return (
      <span
        className={cn(
          "tabular-nums",
          bold && "font-semibold",
          d >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400",
        )}
        title={d >= 0 ? "Dentro da meta zero" : "Estouro sobre meta zero"}
      >
        {d > 0 ? "+" : ""}
        {brl.format(d)}
      </span>
    );
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
  buId = null,
  regime = "competencia",
  fechamento = false,
  liquidacao,
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
  /** BU do DRE exibido — repassada ao detalhamento para a soma fechar. */
  buId?: string | null;
  /** Regime do DRE exibido — idem. */
  regime?: "competencia" | "previsto-realizado";
  /**
   * Modo FECHAMENTO: troca as colunas para Meta | Realizado | AV% | Desvio.
   *
   * A árvore, os filtros (zerados, BU), o drill-down e a expansão de grupos são
   * os mesmos nos dois modos de propósito — duplicá-los num componente separado
   * significaria corrigir cada defeito duas vezes.
   */
  fechamento?: boolean;
  /** % liquidado da competência (0..1 por lado). Alimenta o selo do fechamento. */
  liquidacao?: { despesa: number | null; receita: number | null };
  /** Chamado após salvar uma meta digitada (pra recarregar). */
  onMetaSaved?: () => void;
}) {
  /** Linha aberta no detalhamento ("de onde veio esse número"). */
  const [detalhe, setDetalhe] = useState<{ caId: string; label: string } | null>(null);
  // Grupos expandidos (por código). 03 (Custos) começa aberto, como na referência.
  const [open, setOpen] = useState<Set<string>>(new Set(["03"]));
  // Linhas sem nenhum movimento ficam escondidas por padrão: o plano de contas tem
  // 117 categorias e num mês típico a maioria fica em R$ 0,00, o que enterra o que
  // de fato aconteceu. Um clique traz tudo de volta (é preciso para conferir se uma
  // categoria existe antes de lançar).
  const [mostrarZerados, setMostrarZerados] = useState(false);
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
  /** 0..1 → "87,6%"; null (nada previsto naquele lado) → "—". */
  const pctLiq = (v: number | null | undefined) =>
    v == null ? "—" : `${(v * 100).toFixed(1).replace(".", ",")}%`;
  // 90% é o corte: abaixo disso o desvio ainda está sendo formado e enganaria.
  const baixaLiquidacao =
    fechamento &&
    !!liquidacao &&
    ((liquidacao.despesa ?? 1) < 0.9 || (liquidacao.receita ?? 1) < 0.9);
  // A meta só é digitável no fechamento, e não na visão "Sem BU" — ali não há
  // unidade a que atribuí-la, e o orçado volta vazio de qualquer forma.
  const podeEditarMeta =
    fechamento && temPrevReal && !!competencia && !!onMetaSaved && buId !== "sem";
  // Três layouts, um por modo. O DRE não tem mais colunas condicionais: o que
  // decide é o modo, não a existência de meta.
  // As colunas que levam PAD_GRUPO vêm mais largas: o padding come espaço útil,
  // e sem folga o número encostaria no título da coluna seguinte.
  const cols = fechamento
    ? "grid-cols-[1fr_10.5rem_4.5rem_8.5rem_4.5rem_8.5rem]"
    : temPrevReal
      ? "grid-cols-[1fr_8rem_6rem_8rem_4.5rem]"
      : "grid-cols-[1fr_9rem_6rem]";

  /**
   * Grupo cujas folhas NUNCA são escondidas, mesmo zeradas.
   *
   * O Faturamento Bruto é a régua do DRE: cada linha zerada ali é uma fonte de
   * receita que não vendeu neste mês, e sumir com ela esconde justamente a
   * informação que o gestor precisa ver. Nas despesas vale o contrário — uma
   * categoria sem lançamento é ruído.
   */
  const GRUPO_SEMPRE_VISIVEL = "01";

  /** Sem previsto, sem realizado e sem meta = nada a dizer sobre esta linha. */
  const semMovimento = (l: { valor: number; previsto: number; orcado: number }) =>
    l.valor === 0 && l.previsto === 0 && l.orcado === 0;

  /**
   * Folhas visíveis de um grupo. Um cabeçalho de subgrupo (03.1/03.2) só some
   * quando TODAS as folhas dele sumiram — senão sobraria um título órfão, ou
   * folhas soltas sem o subgrupo a que pertencem.
   */
  const filhosVisiveis = (row: Extract<DreRow, { kind: "group" }>) => {
    if (mostrarZerados || row.codigo === GRUPO_SEMPRE_VISIVEL) return row.children;
    // Índice do próximo cabeçalho de subgrupo, para delimitar cada segmento.
    return row.children.filter((leaf, i) => {
      if (!semMovimento(leaf)) return true;
      if (!leaf.sub) return false;
      for (let j = i + 1; j < row.children.length; j++) {
        const p = row.children[j];
        if (p.sub) break; // começou outro subgrupo
        if (!semMovimento(p)) return true; // tem folha com movimento: mantém o título
      }
      return false;
    });
  };

  /**
   * Células de valores de uma linha (tudo após "Categoria").
   *
   * FECHAMENTO: Meta | Realizado | AV% | Desvio — a leitura de "entregamos o que
   * prometemos?". O desvio aqui compara o REALIZADO com a meta, que é o sentido
   * do fechamento; o selo de liquidação acima avisa quando o mês ainda não
   * liquidou o bastante para essa conta valer.
   *
   * OPERACIONAL: Previsto | AV% | Realizado | AV% — o acompanhamento do mês.
   * Sem Meta e sem Desvio: eles vivem no painel de Fechamento.
   */
  const Cells = ({
    valor,
    previsto,
    avReal,
    avPrevisto,
    avOrc,
    orcado,
    temMeta,
    bold,
    small,
    metaEditor,
    previstoEhMeta,
    previstoSemMeta,
  }: {
    valor: number;
    previsto: number;
    avReal: number;
    avPrevisto: number;
    /** AV% da meta, sobre a Receita Bruta planejada. */
    avOrc: number;
    orcado: number;
    temMeta: boolean;
    bold?: boolean;
    small?: boolean;
    /** Substitui a célula Meta por um editor (Faturamento Bruto, no fechamento). */
    metaEditor?: ReactNode;
    /** O previsto desta linha é a META (Faturamento Bruto, regime competência). */
    previstoEhMeta?: boolean;
    /** Deveria ser meta, mas não há meta cadastrada → mostra "—". */
    previstoSemMeta?: boolean;
  }) => {
    const txt = small ? "text-xs" : "text-sm";

    if (fechamento) {
      return (
        <>
          {/* Afasta a Meta do Realizado: coladas, os dois números viravam um
              bloco só e a leitura "planejado × aconteceu" se perdia. */}
          {metaEditor ?? (
            <span
              className={cn(
                "text-right tabular-nums",
                txt,
                // A meta é dado de primeira classe aqui — não pode ser mais fraca
                // que o realizado ao lado. Só o "sem meta" fica apagado.
                temMeta ? "text-foreground" : "text-muted-foreground/60 italic",
              )}
            >
              {temMeta ? brl.format(orcado) : "sem meta"}
            </span>
          )}
          {/* AV da META, fechando o par "meta + sua análise" — espelha o que a
              Visão de Caixa faz com previsto e realizado. Sem meta cadastrada
              não há percentual a mostrar: 0% ali seria afirmar um plano que
              ninguém fez. */}
          <span
            className={cn(
              PAD_GRUPO,
              "text-right text-muted-foreground",
              txt,
              bold && "font-semibold",
            )}
          >
            {temMeta ? fmtAv(avOrc) : "—"}
          </span>
          <span className="text-right">
            <Valor value={valor} bold={bold} />
          </span>
          <span className={cn("text-right text-muted-foreground", txt, bold && "font-semibold")}>
            {fmtAv(avReal)}
          </span>
          <span className={cn("text-right", txt)}>
            <Desvio valor={valor} orcado={orcado} temMeta={temMeta} bold={bold} />
          </span>
        </>
      );
    }

    if (!temPrevReal) {
      // Modo Conta Azul (pré-cutover): valor único, sem previsto separado.
      return (
        <>
          <span className="text-right">
            <Valor value={valor} bold={bold} />
          </span>
          <span className={cn("text-right text-muted-foreground", txt, bold && "font-semibold")}>
            {fmtAv(avReal)}
          </span>
        </>
      );
    }

    return (
      <>
        <span className="text-right">
          {/* Sem meta cadastrada, "—" e não 0,00: ausência de meta não é meta
              zero, e mostrar zero esconderia o mês que ninguém planejou. */}
          {previstoSemMeta ? (
            <span
              className={cn("text-muted-foreground/60", txt)}
              title="Nenhuma meta cadastrada nesta competência."
            >
              —
            </span>
          ) : (
            <span
              title={
                previstoEhMeta
                  ? "Valor PLANEJADO da competência (meta), não o apurado até agora"
                  : undefined
              }
            >
              <Valor value={previsto} bold={bold} />
            </span>
          )}
        </span>
        {/* O respiro vai no AV% do PREVISTO: ele fecha o par "previsto + sua
            análise", separando-o do par do realizado. Sem isso as quatro colunas
            viram uma fileira só de números. */}
        <span
          className={cn(
            PAD_GRUPO,
            "text-right text-muted-foreground",
            txt,
            bold && "font-semibold",
          )}
        >
          {fmtAv(avPrevisto)}
        </span>
        <span className="text-right">
          <Valor value={valor} bold={bold} />
        </span>
        <span className={cn("text-right text-muted-foreground", txt, bold && "font-semibold")}>
          {fmtAv(avReal)}
        </span>
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
      {/* SELO DE LIQUIDAÇÃO — a trava de honestidade do fechamento.
          No dia 4 a despesa está 0% liquidada (vencimentos começam no dia 5) e o
          desvio mostraria −100% em tudo, parecendo catástrofe. Os dois lados vêm
          separados porque a receita costuma liquidar acima de 97% e a despesa
          depende da rotina de baixa. */}
      {fechamento && liquidacao ? (
        <div
          className={cn(
            "flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-[11px]",
            baixaLiquidacao
              ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
              : "border-border bg-muted/30 text-muted-foreground",
          )}
        >
          <span className="font-medium">
            {pctLiq(liquidacao.despesa)} da despesa liquidada
          </span>
          <span className="opacity-70">·</span>
          <span className="font-medium">
            {pctLiq(liquidacao.receita)} da receita recebida
          </span>
          {baixaLiquidacao ? (
            <span className="w-full sm:w-auto sm:ml-auto">
              O mês ainda não liquidou — o desvio abaixo <strong>não</strong> reflete o
              resultado final.
            </span>
          ) : null}
        </div>
      ) : null}
      {/* O aviso de "sem metas" só faz sentido onde a meta é mostrada. */}
      {fechamento && !temOrcamento ? (
        <div className="border-b border-border bg-muted/20 px-4 py-1.5 text-[11px] text-muted-foreground">
          Nenhuma meta nesta competência — cadastre em{" "}
          <strong>Orçamento &amp; Limite</strong> (despesa) ou digite direto na coluna{" "}
          <strong>Meta</strong> abaixo (faturamento).
        </div>
      ) : null}
      <div
        className={cn(
          "grid items-center gap-2 border-b border-border bg-muted/50 px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground",
          cols,
        )}
      >
        <span className="flex items-center gap-2">
          Categoria
          {/* Só aparece quando há o que revelar/esconder — em um mês cheio some. */}
          {rows.some(
            (r) =>
              r.kind === "group" &&
              r.codigo !== GRUPO_SEMPRE_VISIVEL &&
              r.children.some(semMovimento),
          ) ? (
            <button
              type="button"
              onClick={() => setMostrarZerados((v) => !v)}
              className="rounded border border-border px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-muted-foreground hover:text-foreground"
              title="O Faturamento Bruto mostra todas as linhas sempre, mesmo zeradas."
            >
              {mostrarZerados ? "ocultar zerados" : "mostrar zerados"}
            </button>
          ) : null}
        </span>
        {fechamento ? (
          <>
            <span
              className="text-right"
              title="O que foi planejado para esta competência."
            >
              Meta
            </span>
            {/* O respiro fecha o par "meta + sua análise" e o separa do par do
                realizado — mesma regra do layout de Visão de Caixa. Sem ele as
                quatro colunas viram uma fileira só de números. */}
            <span
              className={cn(PAD_GRUPO, "text-right")}
              title="Peso da meta sobre a Receita Bruta PLANEJADA — a meta medida contra o próprio plano."
            >
              AV %
            </span>
            <span
              className="text-right"
              title="O que de fato foi pago/recebido. Não é o Fluxo de Caixa."
            >
              Realizado
            </span>
            <span
              className="text-right"
              title="Peso do realizado sobre a Receita Bruta realizada."
            >
              AV %
            </span>
            <span
              className="text-right"
              title="Realizado − Meta. Positivo = melhor que o planejado, nos dois lados."
            >
              Desvio
            </span>
          </>
        ) : temPrevReal ? (
          <>
            <span
              className="text-right"
              title="O custo/receita GERADO neste mês (competência) — pago ou não. É o resultado do mês."
            >
              Previsto
            </span>
            <span className={cn(PAD_GRUPO, "text-right")}>AV %</span>
            <span
              className="text-right"
              title="O que já foi pago/recebido destas linhas. Não é o Fluxo de Caixa."
            >
              Realizado
            </span>
            <span className="text-right">AV %</span>
          </>
        ) : (
          <>
            <span className="text-right">Valor</span>
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
                  avOrc={row.avOrc}
                  orcado={row.orcado}
                  temMeta={row.temMeta}
                  // LUCRO LÍQUIDO no regime de competência: o previsto é o
                  // resultado PLANEJADO, não a soma corrente do apurado.
                  previstoEhMeta={row.previstoEhMeta}
                  previstoSemMeta={row.previstoSemMeta}
                  bold
                />
              </div>
            );
          }

          const isOpen = open.has(row.codigo);
          const visiveis = filhosVisiveis(row);
          const ocultas = row.children.length - visiveis.length;
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
                  avOrc={row.avOrc}
                  orcado={row.orcado}
                  temMeta={row.temMeta}
                  // Só a linha de GRUPO carrega as flags: o Faturamento Bruto no
                  // regime de competência mostra a META no previsto.
                  previstoEhMeta={row.previstoEhMeta}
                  previstoSemMeta={row.previstoSemMeta}
                />
              </button>

              {isOpen && ocultas > 0 ? (
                <button
                  type="button"
                  onClick={() => setMostrarZerados(true)}
                  className="w-full border-b border-border/50 bg-background/40 px-4 py-1.5 pl-11 text-left text-[11px] text-muted-foreground hover:text-foreground"
                >
                  {ocultas} {ocultas === 1 ? "linha zerada" : "linhas zeradas"} oculta
                  {ocultas === 1 ? "" : "s"} · mostrar
                </button>
              ) : null}

              {isOpen && hasChildren
                ? visiveis.map((leaf, i) => (
                    <div
                      key={`${row.codigo}-${i}`}
                      className={cn(
                        "fin-row grid items-center gap-2 bg-background/40 px-4 py-2 pl-11",
                        cols,
                        leaf.sub && "bg-muted/20",
                      )}
                    >
                      {/* Só folhas de DESPESA abrem o detalhamento: ele lê
                          `fin_parcelas`, então no Faturamento (01) devolveria uma
                          lista vazia — pior que não ser clicável. */}
                      {leaf.caId && !leaf.sub && row.codigo !== GRUPO_SEMPRE_VISIVEL ? (
                        <button
                          type="button"
                          onClick={() =>
                            setDetalhe({ caId: leaf.caId!, label: leaf.label })
                          }
                          className="justify-self-start text-left text-sm text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground"
                          title="Ver as contas que compõem este valor"
                        >
                          {leaf.label}
                        </button>
                      ) : (
                        <span
                          className={cn(
                            "text-sm text-muted-foreground",
                            leaf.sub && "font-medium text-foreground",
                          )}
                        >
                          {leaf.label}
                        </span>
                      )}
                      <Cells
                        valor={leaf.valor}
                        previsto={leaf.previsto}
                        avReal={leaf.av}
                        avPrevisto={leaf.avPrev}
                        avOrc={leaf.avOrc}
                        orcado={leaf.orcado}
                        temMeta={leaf.temMeta}
                        // Mesmas flags do grupo: no Faturamento Bruto sob
                        // competência, a folha também mostra a META no previsto.
                        previstoEhMeta={leaf.previstoEhMeta}
                        previstoSemMeta={leaf.previstoSemMeta}
                        bold={leaf.sub}
                        small
                        metaEditor={
                          // EXCLUSIVO do Faturamento Bruto (grupo 01): meta digitável
                          // direto no DRE — grava no Orçamento & Limite, na BU aberta.
                          podeEditarMeta && row.codigo === "01" && !leaf.sub && leaf.caId ? (
                            <MetaCell
                              key={`${leaf.caId}-${competencia}-${buId ?? "todas"}-${leaf.orcado}`}
                              caId={leaf.caId}
                              competencia={competencia!}
                              buId={buId}
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

      {/* `key` por linha: trocar de categoria remonta o diálogo, então o estado
          nasce limpo sem precisar zerá-lo à mão dentro do efeito. */}
      <DetalheDialog
        key={detalhe?.caId ?? "nenhum"}
        alvo={detalhe}
        competencia={competencia}
        buId={buId}
        regime={regime}
        somentePagas={fechamento}
        onClose={() => setDetalhe(null)}
      />
    </div>
  );
}

const fmtDia = (iso: string | null) =>
  iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—";

/**
 * "De onde veio esse número": lista as parcelas por trás de uma linha do DRE.
 *
 * Busca com a MESMA competência, BU e regime da tabela — é o que faz a soma
 * daqui fechar com o valor da linha. Quando há rateio, mostra a fatia e o valor
 * cheio lado a lado, senão a conta "não bate" aos olhos de quem confere.
 */
function DetalheDialog({
  alvo,
  competencia,
  buId,
  regime,
  somentePagas = false,
  onClose,
}: {
  alvo: { caId: string; label: string } | null;
  competencia?: string;
  buId: string | null;
  regime: "competencia" | "previsto-realizado";
  /** Fechamento: lista só o que foi pago, para fechar com a coluna Realizado. */
  somentePagas?: boolean;
  onClose: () => void;
}) {
  const [dados, setDados] = useState<{
    itens: DreDetalheItem[];
    total: number;
    totalRealizado: number;
  } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!alvo) return;
    const qs = new URLSearchParams({ caId: alvo.caId });
    if (competencia) qs.set("competencia", competencia);
    if (buId) qs.set("bu", buId);
    if (regime === "previsto-realizado") qs.set("regime", regime);
    // No fechamento a linha exibe o REALIZADO, então o detalhe só pode listar o
    // que foi pago — senão a soma do popup passa da linha clicada.
    if (somentePagas) qs.set("pagas", "1");
    let vivo = true;
    void (async () => {
      try {
        const res = await fetch(`/api/financeiro/dre/detalhe?${qs}`);
        const txt = await res.text();
        if (!txt) throw new Error("resposta vazia do servidor");
        const j = JSON.parse(txt);
        if (!res.ok || j.error) throw new Error(j.error ?? `HTTP ${res.status}`);
        if (vivo) setDados(j);
      } catch (e) {
        if (vivo) setErro((e as Error).message);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [alvo, competencia, buId, regime, somentePagas]);

  if (!alvo) return null;
  const temRateio = dados?.itens.some((i) => i.rateada) ?? false;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      {/* `sm:max-w-*` porque a classe base do DialogContent traz `sm:max-w-sm`:
          um `max-w-` sem prefixo não vence a variante responsiva e o diálogo
          ficava preso em 384px, obrigando a rolar de lado. */}
      <DialogContent className="w-[min(60rem,95vw)] sm:max-w-[min(60rem,95vw)]">
        <DialogHeader>
          <DialogTitle className="text-base">{alvo.label}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          {competencia} ·{" "}
          {regime === "previsto-realizado"
            ? "agrupado pelo vencimento"
            : "agrupado pela competência"}
          {buId ? " · filtrado por BU" : ""}
        </p>

        {erro ? <p className="text-sm text-destructive">{erro}</p> : null}
        {!dados && !erro ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : null}

        {dados ? (
          dados.itens.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma conta nesta competência.
            </p>
          ) : (
            <>
              {/* Lista, não tabela: com nomes longos ("PROF. GUILHERME FEITOSA")
                  colunas fixas empurram o valor para fora e obrigam a rolar de
                  lado. Aqui a descrição ocupa o espaço que sobra e o valor fica
                  ancorado à direita, sem `overflow-x` em nenhuma largura. */}
              <ul className="max-h-104 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                {dados.itens.map((i) => (
                  <li
                    key={i.parcelaId}
                    className="fin-row flex items-baseline gap-3 px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="block text-sm">{i.descricao}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        vence {fmtDia(i.dataVencimento)}
                        {i.numParcelas > 1 ? ` · ${i.numero}/${i.numParcelas}` : ""}
                        {i.recorrente ? " · recorrência" : ""}
                        {i.buNome ? ` · ${i.buNome}` : " · sem BU"}
                        {i.centroNome ? ` · ${i.centroNome}` : ""}
                      </span>
                    </div>
                    {i.status === "paga" ? (
                      <span className="shrink-0 whitespace-nowrap rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">
                        paga {fmtDia(i.dataPagamento)}
                      </span>
                    ) : (
                      <span className="shrink-0 whitespace-nowrap rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {i.status === "a_pagar" ? "a pagar" : i.status}
                      </span>
                    )}
                    <span className="shrink-0 whitespace-nowrap text-right text-sm tabular-nums">
                      {brl.format(i.valor)}
                      {i.rateada ? (
                        <span className="block text-[10px] font-normal text-muted-foreground">
                          de {brl.format(i.valorCheio)}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
              {/* O total precisa ser o MESMO número da linha clicada: no
                  fechamento a linha mostra o realizado; no operacional, o
                  previsto. Mostrar o outro aqui faria a soma "não bater". */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">
                  {dados.itens.length} conta{dados.itens.length === 1 ? "" : "s"}
                  {somentePagas ? " paga" : ""}
                  {somentePagas && dados.itens.length !== 1 ? "s" : ""}
                  {somentePagas ? "" : ` · realizado ${brl.format(dados.totalRealizado)}`}
                </span>
                <span className="font-medium tabular-nums">
                  Total {brl.format(somentePagas ? dados.totalRealizado : dados.total)}
                </span>
              </div>
              {temRateio ? (
                <p className="text-[11px] text-muted-foreground">
                  Onde aparece <strong>“de R$ …”</strong>, a conta é rateada entre BUs
                  e o valor acima é só a fatia que entra nesta linha.
                </p>
              ) : null}
            </>
          )
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
