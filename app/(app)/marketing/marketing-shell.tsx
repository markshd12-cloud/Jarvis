"use client";

import { useState } from "react";
import {
  IconArrowsLeftRight,
  IconBrandInstagram,
  IconBrandMeta,
  IconBrandTiktok,
  IconBrandYoutube,
  IconCoin,
  IconLayoutDashboard,
  IconWorld,
} from "@tabler/icons-react";

import { FloatingDock } from "@/components/ui/floating-dock";

/**
 * Casca do módulo Marketing (espelha o Financeiro): navegação por sub-abas via
 * FloatingDock. As abas prontas (Meta Ads, Instagram, GA4) recebem o painel já
 * renderizado do servidor como slot; as futuras (Painel consolidado, YouTube,
 * TikTok, Comparativo) entram como "(em breve)". Um slot `null` = sem permissão
 * (o servidor não montou) → a aba não aparece.
 */
type TabKey =
  | "meta"
  | "instagram"
  | "ga4"
  | "youtube"
  | "cac"
  | "painel"
  | "tiktok"
  | "comparativo";

const iconCls = "h-full w-full text-neutral-500 dark:text-neutral-300";

function EmBreve({ nome }: { nome: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-16 text-center">
      <p className="text-sm font-medium">{nome}</p>
      <p className="max-w-sm text-xs text-muted-foreground">
        Integração planejada — ver o mapa de passos em <code>docs/marketing-status.md</code>.
      </p>
    </div>
  );
}

export function MarketingShell({
  meta,
  instagram,
  ga4,
  youtube,
  cac,
}: {
  meta: React.ReactNode | null;
  instagram: React.ReactNode | null;
  ga4: React.ReactNode | null;
  youtube: React.ReactNode | null;
  cac: React.ReactNode | null;
}) {
  const has = {
    meta: !!meta,
    instagram: !!instagram,
    ga4: !!ga4,
    youtube: !!youtube,
    cac: !!cac,
  };

  const TABS: { key: TabKey; label: string; ready: boolean; icon: React.ReactNode }[] = [
    { key: "meta", label: "Meta Ads", ready: has.meta, icon: <IconBrandMeta className={iconCls} /> },
    { key: "instagram", label: "Instagram", ready: has.instagram, icon: <IconBrandInstagram className={iconCls} /> },
    { key: "ga4", label: "GA4 / Site", ready: has.ga4, icon: <IconWorld className={iconCls} /> },
    { key: "painel", label: "Painel", ready: false, icon: <IconLayoutDashboard className={iconCls} /> },
    { key: "youtube", label: "YouTube", ready: has.youtube, icon: <IconBrandYoutube className={iconCls} /> },
    { key: "cac", label: "CAC", ready: has.cac, icon: <IconCoin className={iconCls} /> },
    { key: "tiktok", label: "TikTok", ready: false, icon: <IconBrandTiktok className={iconCls} /> },
    { key: "comparativo", label: "Comparativo", ready: false, icon: <IconArrowsLeftRight className={iconCls} /> },
  ];

  const firstReady = TABS.find((t) => t.ready)?.key ?? "painel";
  const [active, setActive] = useState<TabKey>(firstReady);

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
    <main>
      <section>
        <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col gap-6 px-4 py-8">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">Marketing</h1>
            <p className="text-muted-foreground">
              Visão consolidada — todas as marcas e canais.
            </p>
          </div>

          <div className="flex justify-center">
            <FloatingDock items={dockItems} />
          </div>

          {active === "meta" ? (has.meta ? meta : <EmBreve nome="Meta Ads — sem permissão" />) : null}
          {active === "instagram" ? (has.instagram ? instagram : <EmBreve nome="Instagram — sem permissão" />) : null}
          {active === "ga4" ? (has.ga4 ? ga4 : <EmBreve nome="GA4 — sem permissão" />) : null}
          {active === "painel" ? <EmBreve nome="Painel consolidado" /> : null}
          {active === "youtube" ? (has.youtube ? youtube : <EmBreve nome="YouTube" />) : null}
          {active === "cac" ? (has.cac ? cac : <EmBreve nome="CAC — requer Marketing + Financeiro" />) : null}
          {active === "tiktok" ? <EmBreve nome="TikTok" /> : null}
          {active === "comparativo" ? <EmBreve nome="Comparativo entre canais" /> : null}
        </div>
      </section>
    </main>
  );
}
