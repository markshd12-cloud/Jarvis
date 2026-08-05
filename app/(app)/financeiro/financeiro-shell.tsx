"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDownIcon } from "lucide-react";
import {
  IconAddressBook,
  IconAlertTriangle,
  IconCategory,
  IconWand,
  IconChartLine,
  IconChartPie,
  IconLayoutDashboard,
  IconReceipt2,
  IconReportMoney,
  IconCoin,
  IconRepeat,
  IconShoppingCart,
  IconTargetArrow,
  IconUsers,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FloatingDock } from "@/components/ui/floating-dock";
import { cn } from "@/lib/utils";
import type { DreResult } from "@/lib/contaazul/dre";

import { CadastrosPanel } from "@/components/financeiro/cadastros-panel";
import { CentroCustoPanel } from "@/components/financeiro/centro-custo-panel";
import { ClassificacaoPanel } from "@/components/financeiro/classificacao-panel";
import { ClientesPanel } from "@/components/financeiro/clientes-panel";
import { ColaboradoresPanel } from "@/components/financeiro/colaboradores-panel";
import { ContasPagarPanel } from "@/components/financeiro/contas-pagar-panel";
import { DreConfigPanel } from "@/components/financeiro/dre-config-panel";
import { DreTable } from "@/components/financeiro/dre-table";
import { FluxoCaixaPanel } from "@/components/financeiro/fluxo-caixa-panel";
import { InadimplentesPanel } from "@/components/financeiro/inadimplentes-panel";
import { OrcamentoPanel } from "@/components/financeiro/orcamento-panel";
import { PainelPanel } from "@/components/financeiro/painel-panel";
import { ReceitaPanel } from "@/components/financeiro/receita-panel";
import { RecorrenciasPanel } from "@/components/financeiro/recorrencias-panel";
import { VendasPanel } from "@/components/financeiro/vendas-panel";

/**
 * Casca do módulo Financeiro: navegação entre sub-abas via FloatingDock. A aba
 * DRE puxa os dados reais do Conta Azul (`/api/financeiro/dre`); as demais entram
 * nas próximas fases. Filtros usam Button + DropdownMenu do Jarvis.
 */
type TabKey =
  | "painel"
  | "dre"
  | "caixa"
  | "centro"
  | "pagar"
  | "vendas"
  | "cadastros"
  | "colaboradores"
  | "recorrencias"
  | "orcamento"
  | "receita"
  | "inadimplentes"
  | "clientes"
  | "classificacao";

/**
 * Recorte escolhido no DRE. Os dois primeiros trocam a data que decide o mês da
 * linha; `meta-realizado` mantém a competência e troca as COLUNAS (fechamento).
 */
type RegimeUi = "competencia" | "previsto-realizado" | "meta-realizado";

const iconCls = "h-full w-full text-neutral-500 dark:text-neutral-300";

const TABS: { key: TabKey; label: string; ready: boolean; icon: React.ReactNode }[] =
  [
    { key: "painel", label: "Painel", ready: true, icon: <IconLayoutDashboard className={iconCls} /> },
    { key: "dre", label: "DRE", ready: true, icon: <IconReportMoney className={iconCls} /> },
    { key: "caixa", label: "Fluxo de Caixa", ready: true, icon: <IconChartLine className={iconCls} /> },
    { key: "centro", label: "% Centro de Custo", ready: true, icon: <IconChartPie className={iconCls} /> },
    { key: "pagar", label: "Contas a Pagar", ready: true, icon: <IconReceipt2 className={iconCls} /> },
    { key: "recorrencias", label: "Recorrências", ready: true, icon: <IconRepeat className={iconCls} /> },
    { key: "orcamento", label: "Orçamento & Limite", ready: true, icon: <IconTargetArrow className={iconCls} /> },
    { key: "receita", label: "Receita", ready: true, icon: <IconCoin className={iconCls} /> },
    { key: "inadimplentes", label: "Inadimplentes", ready: true, icon: <IconAlertTriangle className={iconCls} /> },
    { key: "vendas", label: "Vendas e Faturar", ready: true, icon: <IconShoppingCart className={iconCls} /> },
    { key: "cadastros", label: "Categorias & Centros", ready: true, icon: <IconCategory className={iconCls} /> },
    { key: "classificacao", label: "Classificação sugerida", ready: true, icon: <IconWand className={iconCls} /> },
    { key: "colaboradores", label: "Colaboradores", ready: true, icon: <IconUsers className={iconCls} /> },
    { key: "clientes", label: "Clientes", ready: true, icon: <IconAddressBook className={iconCls} /> },
  ];

const MESES_ABREV = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

/** 'AAAA-MM' → 'Jul/2026'. */
function labelCompetencia(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${MESES_ABREV[(m - 1) % 12]}/${y}`;
}

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
/** Competência do mês corrente (o default do DRE). */
function competenciaAtual(): string {
  return ym(new Date());
}
/**
 * Competências selecionáveis: 3 meses À FRENTE … 11 atrás (recente → antigo).
 * Incluir o futuro é essencial na virada de mês: no dia 31/07 é preciso poder
 * abrir 08/2026 (o mês que vai ser cortado pro Jarvis) — a lista só-passado
 * escondia justamente o mês do cutover.
 */
function ultimasCompetencias(): string[] {
  const now = new Date();
  return Array.from({ length: 15 }, (_, i) => ym(new Date(now.getFullYear(), now.getMonth() + 3 - i, 1)));
}

export function FinanceiroShell() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  /**
   * Aba ativa na URL (`?aba=pagar`), não em estado volátil.
   *
   * Era `useState("painel")`: qualquer F5 — inclusive o que o próprio app provoca
   * ao salvar — devolvia o usuário ao Painel, mesmo estando em Contas a Pagar.
   * Na URL o recarregamento preserva o lugar, o botão Voltar do navegador passa a
   * funcionar entre abas, e o endereço pode ser compartilhado.
   */
  /** Lê um parâmetro da URL, caindo no padrão quando ausente ou inválido. */
  const param = (chave: string, valido: (v: string) => boolean, padrao: string) => {
    const v = searchParams.get(chave);
    return v && valido(v) ? v : padrao;
  };

  /**
   * Grava parâmetros na URL. Valor vazio/null REMOVE a chave, para o endereço
   * não acumular `bu=&regime=competencia` quando nada está filtrado.
   *
   * `replace` + `scroll: false`: mudar de aba ou de mês não é navegação de
   * conteúdo novo — não deve empilhar histórico a cada clique nem jogar o scroll
   * para o topo.
   */
  const setParams = (patch: Record<string, string | null>) => {
    const qs = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (!v) qs.delete(k);
      else qs.set(k, v);
    }
    const s = qs.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };

  const active = useMemo<TabKey>(
    () =>
      param("aba", (v) => TABS.some((t) => t.key === v && t.ready), "painel") as TabKey,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searchParams],
  );
  const setActive = (key: TabKey) => setParams({ aba: key });

  const competencias = ultimasCompetencias();
  /**
   * Competência, BU e regime também moram na URL. Sem isso, recarregar no DRE de
   * julho filtrado por Colégio devolvia o mês corrente em "Todas" — perdendo a
   * visão que estava sendo analisada. Default = mês corrente (não o 1º da lista,
   * que agora é 3 meses à frente).
   */
  const competencia = param(
    "comp",
    (v) => /^\d{4}-\d{2}$/.test(v),
    competenciaAtual(),
  );
  const setCompetencia = (v: string) => setParams({ comp: v });

  // BU do DRE: "" = Todas (consolidado); id = uma unidade (usa rateio + espelho);
  // "sem" = receita sem BU resolvida.
  const [bus, setBus] = useState<{ id: string; nome: string }[]>([]);
  const buId = param("bu", (v) => v === "sem" || /^[0-9a-f-]{36}$/i.test(v), "");
  const setBuId = (v: string) => setParams({ bu: v });

  /**
   * Recorte do DRE. Os dois primeiros mudam qual DATA decide o mês da linha; o
   * terceiro muda as COLUNAS.
   * - competência: o custo do mês (salário de julho pago em ago cai em JULHO)
   * - previsto-realizado: as contas que caem no mês (esse salário cai em AGOSTO)
   * - meta-realizado: fechamento — Meta × Realizado, sempre por competência
   * O Fluxo de Caixa não é afetado — lá a saída é sempre na data do pagamento.
   */
  const regime = param(
    "regime",
    (v) => v === "previsto-realizado" || v === "meta-realizado",
    "competencia",
  ) as RegimeUi;
  /**
   * 'competencia' é o padrão — não polui a URL.
   *
   * Trocar de regime NÃO mexe na competência. Cheguei a fazer o fechamento
   * pular para o mês anterior (o corrente está perto de 0% liquidado), mas o
   * `comp` fica na URL: voltar para Competência mantinha o mês antigo, e o
   * usuário ficava preso em julho sem ter pedido. Quem avisa que o mês ainda
   * não liquidou é o selo no topo da tabela — sem sequestrar a navegação.
   */
  const setRegime = (v: RegimeUi) =>
    setParams({ regime: v === "competencia" ? null : v });

  /** Fechamento troca as colunas, não o agrupamento. */
  const fechamento = regime === "meta-realizado";
  /**
   * Regime enviado à API e usado no drill-down. O fechamento é SEMPRE por
   * competência: a meta é cadastrada por competência (`fin_orcamentos`), então
   * compará-la com um realizado agrupado por vencimento misturaria recortes.
   */
  const regimeApi: "competencia" | "previsto-realizado" = fechamento
    ? "competencia"
    : regime;
  const [dre, setDre] = useState<DreResult | null>(null);
  const [loading, setLoading] = useState(true);
  // Bump p/ recarregar o DRE após importar/mudar cutover (Passo 11).
  const [reloadKey, setReloadKey] = useState(0);

  // BUs reais (uma vez) para o seletor do DRE por BU.
  useEffect(() => {
    let cancel = false;
    fetch("/api/financeiro/bus")
      .then((r) => r.json())
      .then((j) => {
        if (!cancel)
          setBus(
            (j.bus ?? [])
              .filter((b: { ativo?: boolean }) => b.ativo !== false)
              .map((b: { id: string; nome: string }) => ({ id: b.id, nome: b.nome })),
          );
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, []);

  const buLabel =
    buId === "sem" ? "Sem BU" : buId ? (bus.find((b) => b.id === buId)?.nome ?? "BU") : "Todas";

  useEffect(() => {
    // Fechamento consome exatamente o mesmo endpoint — só muda a leitura das
    // colunas. Sem incluí-lo aqui, a aba abriria vazia.
    if (active !== "dre") return;
    let cancel = false;
    setLoading(true);
    fetch(
      `/api/financeiro/dre?competencia=${competencia}${buId ? `&bu=${buId}` : ""}` +
        (regimeApi === "previsto-realizado" ? "&regime=previsto-realizado" : ""),
    )
      .then((r) => r.json())
      .then((data: DreResult) => {
        if (!cancel) {
          setDre(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancel) {
          setDre({
            connected: false,
            competencia,
            receitaBruta: 0,
            receitaBrutaPrev: 0,
            temPrevReal: false,
            rows: [],
            semMapeamento: 0,
            atualizadoAte: null,
            temOrcamento: false,
            liquidacao: { despesa: null, receita: null },
            despesaFonte: "contaazul",
            cutover: null,
          });
          setLoading(false);
        }
      });
    return () => {
      cancel = true;
    };
  }, [competencia, active, reloadKey, buId, regimeApi]);

  const dockItems = TABS.map((tab) => ({
    title: tab.ready ? tab.label : `${tab.label} (em breve)`,
    icon: tab.icon,
    active: active === tab.key,
    onClick: (e: React.MouseEvent) => {
      e.preventDefault();
      if (tab.ready) setActive(tab.key);
    },
  }));

  return (
    <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col gap-6 px-4 py-8">
      {/* Sub-abas (floating dock) */}
      <div className="flex justify-center">
        <FloatingDock items={dockItems} />
      </div>

      {active === "painel" ? <PainelPanel /> : null}

      {active === "dre" ? (
        <section className="flex flex-col gap-4">
          {/* Recorte do DRE. Dois botões (não dropdown): é a decisão que mais
              muda a leitura da tela, então fica sempre visível qual está ativo. */}
          <div className="flex rounded-lg border border-border p-0.5">
            {(
              [
                {
                  k: "competencia" as const,
                  label: "Competência",
                  hint: "Agrupa pelo mês a que a despesa SE REFERE — o salário de julho pago em agosto cai em julho. É o resultado econômico do mês.",
                },
                {
                  k: "previsto-realizado" as const,
                  label: "Previsto e Realizado",
                  hint: "Agrupa pelo VENCIMENTO — as contas que caem neste mês. Esse mesmo salário cai em agosto.",
                },
                {
                  k: "meta-realizado" as const,
                  label: "Meta e Realizado",
                  hint: "FECHAMENTO: o que foi planejado contra o que de fato aconteceu. Sempre por competência (a meta é cadastrada por competência). Abre no mês anterior — o mês corrente ainda não liquidou.",
                },
              ]
            ).map((o) => (
              <button
                key={o.k}
                onClick={() => setRegime(o.k)}
                title={o.hint}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                  regime === o.k
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>

          {/* Filtros — Button + DropdownMenu padrão do Jarvis */}
          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
                Competência: {labelCompetencia(competencia)}
                <ChevronDownIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {competencias.map((m) => (
                  <DropdownMenuItem key={m} onClick={() => setCompetencia(m)}>
                    {labelCompetencia(m)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
                BU: {buLabel}
                <ChevronDownIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={() => setBuId("")}>Todas</DropdownMenuItem>
                {bus.map((b) => (
                  <DropdownMenuItem key={b.id} onClick={() => setBuId(b.id)}>
                    {b.nome}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem onClick={() => setBuId("sem")}>Sem BU</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="ml-auto flex items-center gap-2">
              {dre?.estruturaFonte === "cache" ? (
                <span
                  className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400"
                  title={
                    dre.estruturaSyncAt
                      ? `Árvore de ${new Date(dre.estruturaSyncAt).toLocaleString("pt-BR")}`
                      : undefined
                  }
                >
                  Estrutura em cache (CA fora)
                </span>
              ) : null}
              {dre?.aviso ? (
                <span className="text-xs text-amber-600 dark:text-amber-400">{dre.aviso}</span>
              ) : null}
            </div>
          </div>

          {/* "De onde veio": no recorte por vencimento, os lançamentos que caem
              neste mês mas se referem a outro. Fica explícito porque a maioria
              vem do import do CA, cuja competência não segue a regra da casa. */}
          {dre?.foraDaCompetencia && dre.foraDaCompetencia.itens.length > 0
            ? (() => {
                const f = dre.foraDaCompetencia!;
                const nImp = f.itens.filter((i) => i.importado).length;
                const nProp = f.itens.length - nImp;
                // Âmbar SÓ quando há item do import (competência definida fora,
                // que pede conferência). Sem eles é a defasagem operando: neutro.
                const alerta = nImp > 0;
                return (
                  <details
                    className={cn(
                      "rounded-lg border",
                      alerta ? "border-amber-500/40 bg-amber-500/5" : "border-border bg-muted/20",
                    )}
                  >
                    <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-xs">
                      <span className="text-muted-foreground">
                        Vencem neste mês, mas são de outra competência:
                      </span>
                      {nProp > 0 && (
                        <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-600 dark:text-emerald-400">
                          ✓ {nProp} seu(s) · {brl(f.totalProprio)} — defasagem configurada
                        </span>
                      )}
                      {nImp > 0 && (
                        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-700 dark:text-amber-400">
                          ⚠ {nImp} do Conta Azul · {brl(f.totalImportado)} — conferir
                        </span>
                      )}
                      <span className="ml-auto text-muted-foreground">ver detalhe ▾</span>
                    </summary>
                    <div className="max-h-64 overflow-y-auto border-t border-border">
                      <table className="fin-table w-full text-[11px]">
                        <thead className="text-left text-muted-foreground">
                          <tr>
                            <th className="px-3 py-1.5 font-medium">Origem</th>
                            <th className="px-3 py-1.5 font-medium">Descrição</th>
                            <th className="px-3 py-1.5 font-medium">Categoria</th>
                            <th className="px-3 py-1.5 font-medium">Competência</th>
                            <th className="px-3 py-1.5 font-medium">Vence</th>
                            <th className="px-3 py-1.5 text-right font-medium">Valor</th>
                          </tr>
                        </thead>
                        <tbody>
                          {f.itens.map((i, n) => (
                            <tr key={n}>
                              <td className="px-3 py-1.5">
                                <span
                                  className={cn(
                                    "rounded px-1.5 py-0.5 text-[10px]",
                                    i.importado
                                      ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                                      : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                                  )}
                                  title={
                                    i.importado
                                      ? "Competência veio do Conta Azul — não segue a regra de defasagem da casa"
                                      : "Lançado no Jarvis com a defasagem configurada"
                                  }
                                >
                                  {i.importado ? "Conta Azul" : "Jarvis"}
                                </span>
                              </td>
                              <td className="px-3 py-1.5">{i.descricao}</td>
                              <td className="px-3 py-1.5 text-muted-foreground">{i.categoria}</td>
                              <td className="px-3 py-1.5 text-muted-foreground">
                                {i.competencia.split("-").reverse().join("/")}
                              </td>
                              <td className="px-3 py-1.5 text-muted-foreground">
                                {i.vencimento.split("-").reverse().join("/")}
                              </td>
                              <td className="px-3 py-1.5 text-right tabular-nums">
                                {brl(i.valor)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                );
              })()
            : null}

          <DreConfigPanel
            competencia={competencia}
            onChanged={() => setReloadKey((k) => k + 1)}
          />

          <DreTable
            rows={dre?.rows ?? []}
            loading={loading}
            connected={dre?.connected ?? true}
            atualizadoAte={dre?.atualizadoAte ?? null}
            despesaFonte={dre?.despesaFonte ?? "contaazul"}
            temOrcamento={dre?.temOrcamento ?? false}
            temPrevReal={dre?.temPrevReal ?? false}
            competencia={competencia}
            // BU e regime seguem para o detalhamento de cada linha: sem eles a
            // soma do popup não fecharia com a linha que foi clicada.
            buId={buId || null}
            regime={regimeApi}
            fechamento={fechamento}
            liquidacao={dre?.liquidacao}
            onMetaSaved={() => setReloadKey((k) => k + 1)}
          />
        </section>
      ) : null}

      {active === "cadastros" ? <CadastrosPanel /> : null}

      {active === "classificacao" ? <ClassificacaoPanel /> : null}

      {active === "centro" ? <CentroCustoPanel /> : null}

      {active === "colaboradores" ? <ColaboradoresPanel /> : null}

      {active === "pagar" ? <ContasPagarPanel /> : null}

      {active === "caixa" ? <FluxoCaixaPanel /> : null}

      {active === "recorrencias" ? <RecorrenciasPanel /> : null}

      {active === "orcamento" ? <OrcamentoPanel /> : null}

      {active === "receita" ? <ReceitaPanel /> : null}

      {active === "inadimplentes" ? <InadimplentesPanel /> : null}

      {active === "vendas" ? <VendasPanel /> : null}

      {active === "clientes" ? <ClientesPanel /> : null}
    </div>
  );
}
