"use client";

import { useEffect, useState } from "react";
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
  const [active, setActive] = useState<TabKey>("painel");
  const competencias = ultimasCompetencias();
  // Default = mês corrente (não o 1º da lista, que agora é 3 meses à frente).
  const [competencia, setCompetencia] = useState(competenciaAtual);
  // BU do DRE: "" = Todas (consolidado); id = uma unidade (usa rateio + espelho).
  const [bus, setBus] = useState<{ id: string; nome: string }[]>([]);
  const [buId, setBuId] = useState("");
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
    if (active !== "dre") return;
    let cancel = false;
    setLoading(true);
    fetch(`/api/financeiro/dre?competencia=${competencia}${buId ? `&bu=${buId}` : ""}`)
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
            rows: [],
            semMapeamento: 0,
            atualizadoAte: null,
            temOrcamento: false,
            despesaFonte: "contaazul",
            cutover: null,
          });
          setLoading(false);
        }
      });
    return () => {
      cancel = true;
    };
  }, [competencia, active, reloadKey, buId]);

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
