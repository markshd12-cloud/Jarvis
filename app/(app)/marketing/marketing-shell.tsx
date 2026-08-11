"use client";

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  IconBrandInstagram,
  IconBrandMeta,
  IconBrandYoutube,
  IconCoin,
  IconTargetArrow,
  IconLayoutDashboard,
  IconWorld,
} from "@tabler/icons-react";

import { FloatingDock } from "@/components/ui/floating-dock";

/**
 * Casca do módulo Marketing (espelha o Financeiro): navegação por sub-abas via
 * FloatingDock. Cada aba pronta recebe do servidor o painel já renderizado como
 * slot; o Painel consolidado ainda entra como "(em breve)".
 *
 * TikTok e Comparativo saíram do dock em 2026-08-05, por decisão do requisitante.
 *
 *  - **TikTok**: integração complexa (app no TikTok for Business + OAuth próprio)
 *    para retorno incerto. Volta se e quando fizer sentido.
 *  - **Comparativo**: com o TikTok fora sobra UM canal pago (Meta Ads), e
 *    comparar canais de mídia entre si perde o sentido. Além disso Instagram e
 *    YouTube não têm custo atribuído, então qualquer "custo por resultado" deles
 *    daria zero — o orgânico pareceria infinitamente eficiente. Precisa antes de
 *    uma decisão de gestão sobre como ratear o custo de conteúdo.
 *
 * Ficaram fora do tipo (e não como `ready: false`) porque "em breve" é uma
 * promessa: uma aba cinza permanente vira ruído e, com o tempo, mentira.
 * Ver `docs/marketing-fase3.md`.
 */
type TabKey = "meta" | "metas" | "instagram" | "ga4" | "youtube" | "cac" | "painel";

const iconCls = "h-full w-full text-neutral-500 dark:text-neutral-300";

/** Esqueleto enquanto o servidor monta o painel da aba recém-aberta. */
function Carregando() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <div className="h-6 w-48 animate-pulse rounded bg-muted" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
      <div className="h-56 animate-pulse rounded-xl bg-muted" />
    </div>
  );
}

/** Permitida sem conteúdo → carregando. Não permitida → aviso. */
function slot(permitida: boolean, conteudo: React.ReactNode | null, nome: string) {
  if (!permitida) return <EmBreve nome={`${nome} — sem permissão`} />;
  return conteudo ?? <Carregando />;
}

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

/** Quais abas o usuário PODE ver — derivado de permissão, não de dado carregado. */
export interface AbasDisponiveis {
  painel: boolean;
  meta: boolean;
  metas: boolean;
  instagram: boolean;
  ga4: boolean;
  youtube: boolean;
  cac: boolean;
}

export function MarketingShell({
  disponivel,
  painel,
  meta,
  metas,
  instagram,
  ga4,
  youtube,
  cac,
}: {
  /**
   * Separado dos slots DE PROPÓSITO. O servidor agora busca só os dados da aba
   * ativa — antes carregava as 14 integrações a cada visita, e abrir o CAC ia
   * ao Meta Ads, Instagram, GA4 e YouTube sem necessidade.
   *
   * Com isso os slots das outras abas chegam `null`, e amarrar a existência da
   * aba ao slot faria o dock perder quase todos os botões: quem abrisse o CAC
   * não teria como voltar ao Instagram. A disponibilidade vem da permissão; o
   * slot só diz se ESTA aba já tem conteúdo.
   */
  disponivel: AbasDisponiveis;
  /** Aba Painel — a de abertura do módulo (decisão de 2026-08-11). */
  painel: React.ReactNode | null;
  meta: React.ReactNode | null;
  /** Aba Metas — null quando o usuário não tem a permissão `marketing`. */
  metas: React.ReactNode | null;
  instagram: React.ReactNode | null;
  ga4: React.ReactNode | null;
  youtube: React.ReactNode | null;
  cac: React.ReactNode | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const has = disponivel;

  const TABS: { key: TabKey; label: string; ready: boolean; icon: React.ReactNode }[] = [
    // PRIMEIRO da lista de propósito: `firstReady` pega o primeiro pronto, e é
    // assim que o Painel virou a aba de abertura do módulo.
    { key: "painel", label: "Painel", ready: has.painel, icon: <IconLayoutDashboard className={iconCls} /> },
    { key: "meta", label: "Meta Ads", ready: has.meta, icon: <IconBrandMeta className={iconCls} /> },
    { key: "metas", label: "Metas", ready: has.metas, icon: <IconTargetArrow className={iconCls} /> },
    { key: "instagram", label: "Instagram", ready: has.instagram, icon: <IconBrandInstagram className={iconCls} /> },
    { key: "ga4", label: "GA4 / Site", ready: has.ga4, icon: <IconWorld className={iconCls} /> },
    { key: "youtube", label: "YouTube", ready: has.youtube, icon: <IconBrandYoutube className={iconCls} /> },
    { key: "cac", label: "CAC", ready: has.cac, icon: <IconCoin className={iconCls} /> },
  ];

  const firstReady = TABS.find((t) => t.ready)?.key ?? "painel";

  /**
   * Aba ativa na URL (`?aba=metas`), não em estado volátil.
   *
   * Era `useState`: qualquer recarga — inclusive a que a própria tela provoca ao
   * trocar a competência das Metas — devolvia o usuário à PRIMEIRA aba (Meta
   * Ads), parecendo que o app tinha "voltado ao dashboard". Na URL a aba
   * sobrevive ao F5, o botão Voltar funciona e o endereço pode ser
   * compartilhado. Mesmo tratamento já dado ao Financeiro.
   */
  const active = useMemo<TabKey>(() => {
    const q = searchParams.get("aba");
    return TABS.some((t) => t.key === q && t.ready) ? (q as TabKey) : firstReady;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, firstReady]);

  const dockItems = TABS.map((tab) => ({
    title: tab.ready ? tab.label : `${tab.label} (em breve)`,
    icon: tab.icon,
    active: active === tab.key,
    onClick: (e: React.MouseEvent) => {
      e.preventDefault();
      if (!tab.ready) return;
      const qs = new URLSearchParams(searchParams.toString());
      qs.set("aba", tab.key);
      // `replace` + `scroll: false`: trocar de aba não é conteúdo novo, não deve
      // empilhar histórico a cada clique nem pular o scroll para o topo.
      router.replace(`${pathname}?${qs}`, { scroll: false });
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

          {/* `slot(...)`: aba permitida mas ainda sem conteúdo = o servidor está
              montando o painel da aba recém-clicada. Mostrar "sem permissão" ali
              seria mentira; um esqueleto diz a verdade e some sozinho. */}
          {active === "meta" ? slot(has.meta, meta, "Meta Ads") : null}
          {active === "metas" ? slot(has.metas, metas, "Metas") : null}
          {active === "instagram" ? slot(has.instagram, instagram, "Instagram") : null}
          {active === "ga4" ? slot(has.ga4, ga4, "GA4") : null}
          {active === "painel" ? slot(has.painel, painel, "Painel") : null}
          {active === "youtube" ? slot(has.youtube, youtube, "YouTube") : null}
          {active === "cac" ? slot(has.cac, cac, "CAC — requer Marketing + Financeiro") : null}
        </div>
      </section>
    </main>
  );
}
