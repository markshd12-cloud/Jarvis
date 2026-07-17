"use client";

import { useEffect, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import {
  IconCategory,
  IconChartLine,
  IconChartPie,
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
import { ColaboradoresPanel } from "@/components/financeiro/colaboradores-panel";
import { ContasPagarPanel } from "@/components/financeiro/contas-pagar-panel";
import { DreConfigPanel } from "@/components/financeiro/dre-config-panel";
import { DreTable } from "@/components/financeiro/dre-table";
import { FluxoCaixaPanel } from "@/components/financeiro/fluxo-caixa-panel";
import { OrcamentoPanel } from "@/components/financeiro/orcamento-panel";
import { ReceitaPanel } from "@/components/financeiro/receita-panel";
import { RecorrenciasPanel } from "@/components/financeiro/recorrencias-panel";

/**
 * Casca do módulo Financeiro: navegação entre sub-abas via FloatingDock. A aba
 * DRE puxa os dados reais do Conta Azul (`/api/financeiro/dre`); as demais entram
 * nas próximas fases. Filtros usam Button + DropdownMenu do Jarvis.
 */
type TabKey =
  | "dre"
  | "caixa"
  | "centro"
  | "pagar"
  | "vendas"
  | "cadastros"
  | "colaboradores"
  | "recorrencias"
  | "orcamento"
  | "receita";

const iconCls = "h-full w-full text-neutral-500 dark:text-neutral-300";

const TABS: { key: TabKey; label: string; ready: boolean; icon: React.ReactNode }[] =
  [
    { key: "dre", label: "DRE", ready: true, icon: <IconReportMoney className={iconCls} /> },
    { key: "caixa", label: "Fluxo de Caixa", ready: true, icon: <IconChartLine className={iconCls} /> },
    { key: "centro", label: "% Centro de Custo", ready: false, icon: <IconChartPie className={iconCls} /> },
    { key: "pagar", label: "Contas a Pagar", ready: true, icon: <IconReceipt2 className={iconCls} /> },
    { key: "recorrencias", label: "Recorrências", ready: true, icon: <IconRepeat className={iconCls} /> },
    { key: "orcamento", label: "Orçamento & Limite", ready: true, icon: <IconTargetArrow className={iconCls} /> },
    { key: "receita", label: "Receita", ready: true, icon: <IconCoin className={iconCls} /> },
    { key: "vendas", label: "Vendas e Faturar", ready: false, icon: <IconShoppingCart className={iconCls} /> },
    { key: "cadastros", label: "Categorias & Centros", ready: true, icon: <IconCategory className={iconCls} /> },
    { key: "colaboradores", label: "Colaboradores", ready: true, icon: <IconUsers className={iconCls} /> },
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

/** Últimos 12 meses (competências) a partir de hoje. */
function ultimasCompetencias(): string[] {
  const now = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
}

// BU fixa em "Geral" nesta fase — as unidades (CPPEM/Colégio/Unicive) vêm depois.
const BUS = ["Geral", "Colégio", "CPPEM", "Unicive"];

export function FinanceiroShell() {
  const [active, setActive] = useState<TabKey>("dre");
  const competencias = ultimasCompetencias();
  const [competencia, setCompetencia] = useState(competencias[0]);
  const [bu, setBu] = useState(BUS[0]);
  const [dre, setDre] = useState<DreResult | null>(null);
  const [loading, setLoading] = useState(true);
  // Bump p/ recarregar o DRE após importar/mudar cutover (Passo 11).
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (active !== "dre") return;
    let cancel = false;
    setLoading(true);
    fetch(`/api/financeiro/dre?competencia=${competencia}`)
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
            despesaFonte: "contaazul",
            cutover: null,
          });
          setLoading(false);
        }
      });
    return () => {
      cancel = true;
    };
  }, [competencia, active, reloadKey]);

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
                BU: {bu}
                <ChevronDownIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {BUS.map((b) => (
                  <DropdownMenuItem key={b} onClick={() => setBu(b)}>
                    {b}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {dre?.aviso ? (
              <span className="ml-auto text-xs text-amber-600 dark:text-amber-400">
                {dre.aviso}
              </span>
            ) : null}
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
          />
        </section>
      ) : null}

      {active === "cadastros" ? <CadastrosPanel /> : null}

      {active === "colaboradores" ? <ColaboradoresPanel /> : null}

      {active === "pagar" ? <ContasPagarPanel /> : null}

      {active === "caixa" ? <FluxoCaixaPanel /> : null}

      {active === "recorrencias" ? <RecorrenciasPanel /> : null}

      {active === "orcamento" ? <OrcamentoPanel /> : null}

      {active === "receita" ? <ReceitaPanel /> : null}
    </div>
  );
}
