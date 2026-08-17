import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getSessionContext } from "@/lib/db/permissions";
import { can, landingHref } from "@/lib/permissions";
import { getMarketingDashboard } from "@/lib/marketing/dashboard";
import {
  getInstagramOverview,
  getInstagramAudience,
  getInstagramStories,
} from "@/lib/marketing/social";
import { getInstagramFunnel } from "@/lib/marketing/instagram-funnel";
import { getYoutubeOverview } from "@/lib/marketing/youtube";
import { YoutubeMetrics } from "@/components/youtube-metrics";
import { getCac } from "@/lib/marketing/cac";
import { cacMesCorrente, cacMesValido } from "@/lib/marketing/cac-opcoes";
import { CacMetrics } from "@/components/cac-metrics";
import { getCompanyId } from "@/lib/db/company";
import { getGa4Overview, getGa4Realtime } from "@/lib/marketing/ga4";
import { getMetaDetail, getMetaBreakdowns } from "@/lib/marketing/meta-detail";
import { getPainelMarketing } from "@/lib/marketing/painel";
import { MARKETING_AD_ACCOUNTS } from "@/lib/marketing/config";
import { MarketingMetrics } from "@/components/marketing-metrics";
import { MarketingPainel } from "@/components/marketing-painel";
import { MarketingMetasPanel } from "@/components/marketing-metas";
import { getMetasComAtual } from "@/lib/marketing/metas";
import { listarConexoes } from "@/lib/marketing/youtube-oauth";
import { detalheDoCanal, janelaDias } from "@/lib/marketing/youtube-analytics";
import { YoutubeConexoes, type ContaYoutube } from "@/components/youtube-conexoes";
import { YoutubeAnalyticsPanel } from "@/components/youtube-analytics-panel";
import { JANELAS, JANELA_PADRAO } from "@/lib/marketing/youtube-janelas";
import { MetaDetailMetrics } from "@/components/meta-detail-metrics";
import { MetaBreakdownsPanel } from "@/components/meta-breakdowns";
import { InstagramMetrics } from "@/components/instagram-metrics";
import { Ga4Metrics } from "@/components/ga4-metrics";

import { MarketingShell } from "./marketing-shell";

export const metadata: Metadata = { title: "Marketing | Jarvis" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * A conta do Google autorizada — UMA cobre todos os canais que ela administra.
 *
 * O desenho anterior listava um item por canal, com botão de conectar em cada, e
 * era impossível de cumprir: CPPEM e Everton são contas de marca, que o Google
 * não oferece no seletor da tela de consentimento. Verificado que a Analytics
 * API aceita qualquer canal administrado pela conta autorizada, a lista por canal
 * deixou de fazer sentido — basta a primeira conexão viva.
 */
function contaYoutube(
  conexoes: { channel_id: string; channel_title: string | null; refresh_token: string | null }[] | null,
): ContaYoutube | null {
  const c = (conexoes ?? [])[0];
  return c
    ? { channelId: c.channel_id, titulo: c.channel_title, temRefresh: !!c.refresh_token }
    : null;
}

/** Canais que a conexão alcança — os do config que têm canal cadastrado. */
const CANAIS_YOUTUBE = MARKETING_AD_ACCOUNTS.filter((b) => b.youtube).map((b) => ({
  channelId: b.youtube as string,
  titulo: b.label,
}));

/**
 * Mês corrente ('AAAA-MM') em **America/Sao_Paulo**, não no fuso do servidor
 * (que é UTC). Na virada do mês o fuso errado devolveria a competência anterior.
 */
function mesCorrenteSP(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  })
    .format(new Date())
    .slice(0, 7);
}

/**
 * Trava de segurança: a página aguarda TODAS as integrações antes de renderizar
 * (Promise.all). Sem isto, uma integração lenta/travada (ex.: CAC lendo o Conta
 * Azul do ano todo ao vivo) faz a página "carregar pra sempre". Aqui, se passar
 * de `ms`, a integração devolve `null` → a seção some, mas a página abre.
 */
function comTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    // O `catch` é tão essencial quanto o timeout: `Promise.race` PROPAGA a
    // rejeição, então uma integração que LANÇA derrubava a página inteira com
    // 500 — não só a seção dela. Aconteceu de verdade quando a tabela
    // `mkt_metas` ainda não existia: o /marketing parou por completo, levando
    // junto Meta Ads, Instagram, GA4 e YouTube, que estavam saudáveis.
    p.catch((e) => {
      console.error(`[marketing] '${label}' falhou — degradando para vazio.`, e);
      return null;
    }),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        console.warn(`[marketing] '${label}' excedeu ${ms}ms — degradando para vazio.`);
        resolve(null);
      }, ms);
    }),
    // `finally` LIMPA o timer. Sem isto o `setTimeout` disparava mesmo quando a
    // integração respondia em 200ms: o log acusava "excedeu 12000ms" de coisas
    // saudáveis, e o processo ficava com dezenas de timers pendentes por
    // carregamento. Os avisos eram ruído, não diagnóstico — e escondiam os
    // estouros de verdade no meio deles.
  ]).finally(() => clearTimeout(timer));
}
const T_RAPIDO = 8_000; // leituras do nosso banco / cacheadas
const T_LENTO = 12_000; // leituras ao vivo (Conta Azul / Graph / GA4)
const T_YOUTUBE = 20_000; // ~12 consultas à Analytics + Data API dos títulos

/**
 * Módulo Marketing — página dedicada (espelha o Financeiro): dock de sub-abas.
 * Cada painel pronto é buscado no servidor conforme a permissão e passado ao
 * shell como slot. Meta Ads + Instagram → `marketing`; GA4 → `ga4` (checkbox
 * próprio na matriz de roles).
 */
export default async function MarketingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getSessionContext();
  const canMarketing = can(ctx, "marketing");
  const canGa4 = can(ctx, "ga4");
  /**
   * CAC exige só `marketing` desde 2026-08-05.
   *
   * Antes pedia `marketing` + `financeiro` porque a aba expunha receita por
   * unidade, rateio e % sobre receita — controladoria vazando para dentro do
   * Marketing. Removido isso, sobrou custo de Marketing/Comercial e vendas, que
   * é justamente o que o setor precisa ver para entender o próprio custo de
   * aquisição. `can()` já libera superadmin automaticamente.
   */
  const canCac = canMarketing;
  if (!canMarketing && !canGa4) redirect(landingHref(ctx) ?? "/sem-acesso");

  const sp = await searchParams;
  const brand = one(sp.brand);

  /**
   * ABA ATIVA — decide o que é buscado.
   *
   * Antes a página carregava as 14 integrações a cada visita, qualquer que fosse
   * a aba. Abrir o CAC ia ao Meta Ads, ao Instagram, ao GA4 e à Analytics do
   * YouTube sem que nada disso aparecesse na tela, e o gargalo mais lento
   * atrasava todo o resto. Agora cada aba paga só a própria conta.
   *
   * O padrão precisa espelhar o `firstReady` do shell (primeira aba permitida),
   * senão a página buscaria os dados de uma aba e o shell mostraria outra.
   */
  const abaPadrao = canMarketing ? "painel" : canGa4 ? "ga4" : "painel";
  const aba = one(sp.aba) ?? abaPadrao;
  const ehAba = (k: string) => aba === k;
  // Competência das METAS ('AAAA-MM'). Independente do range das outras abas:
  // meta é mensal, os painéis trabalham por janela de dias.
  const compRaw = one(sp.comp);
  const competencia = /^\d{4}-\d{2}$/.test(compRaw ?? "")
    ? (compRaw as string)
    : mesCorrenteSP();
  /**
   * Competências do seletor: 2 meses À FRENTE … 12 atrás, ancoradas no MÊS
   * CORRENTE — nunca na competência selecionada.
   *
   * Ancorar no selecionado criava um caminho só de ida: ao escolher julho a
   * lista passava a começar em julho, agosto sumia e não havia como voltar.
   * Os meses futuros importam aqui porque meta se define ANTES do mês começar.
   */
  /**
   * Canal e janela do painel de dados do dono. Um canal por vez — o detalhe (top
   * vídeos, buscas, demografia) só se lê por canal, e são ~12 consultas cada.
   *
   * Padrão: 28 dias, a mesma janela do YouTube Studio. A competência não serve
   * aqui: no dia 5 do mês ela cobriria 5 dias e o gráfico ficaria vazio — foi
   * exatamente o que apareceu na primeira versão.
   */
  const ytCanal = CANAIS_YOUTUBE.some((c) => c.channelId === one(sp.ytCanal))
    ? (one(sp.ytCanal) as string)
    : (CANAIS_YOUTUBE[0]?.channelId ?? "");
  const ytDias = JANELAS.some((j) => j.dias === Number(one(sp.ytDias)))
    ? Number(one(sp.ytDias))
    : JANELA_PADRAO;

  /**
   * Mês do CAC (`?cacMes=AAAA-MM`), padrão o corrente.
   *
   * Um MÊS, não uma janela de presets: o usuário escolhe a competência que quer
   * ver. O gráfico continua cobrindo 12 meses terminando aí, senão viraria uma
   * barra só.
   */
  const cacMes = cacMesValido(one(sp.cacMes)) ? (one(sp.cacMes) as string) : cacMesCorrente();

  const competencias = (() => {
    const [ha, hm] = mesCorrenteSP().split("-").map(Number);
    return Array.from({ length: 15 }, (_, i) => {
      const d = new Date(Date.UTC(ha, hm - 1 + 2 - i, 1));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    });
  })();

  const [
    painel,
    marketing,
    metaDetail,
    metaBreakdowns,
    instagram,
    igFunnel,
    igAudience,
    igStories,
    ga4,
    ga4Realtime,
    youtube,
    metas,
    ytConexoes,
    ytAnalytics,
    cac,
  ] = await Promise.all([
    // Cada linha só dispara se a SUA aba estiver aberta — ver a nota em `aba`.
    // O Painel é a única leitura que toca VÁRIAS fontes; por isso o timeout
    // longo. Ele degrada por bloco internamente (ver `painel.ts`), então um
    // estouro aqui só acontece se tudo estiver lento ao mesmo tempo.
    canMarketing && ehAba("painel")
      // `competencia` é o MESMO estado da aba Metas (`?comp`): uma competência
      // para o módulo, em vez de cada aba com o próprio mês.
      ? comTimeout(getPainelMarketing(competencia), T_YOUTUBE, "painel")
      : Promise.resolve(null),
    canMarketing && ehAba("meta")
      ? comTimeout(
          getMarketingDashboard({
            range: one(sp.range),
            since: one(sp.since),
            until: one(sp.until),
            brand,
          }),
          T_RAPIDO,
          "meta-overview",
        )
      : Promise.resolve(null),
    // Os dois ao vivo recebem o MESMO filtro do painel de cima. Antes recebiam
    // só a marca e ficavam presos em 30 dias móveis — a tela mostrava dois
    // períodos ao mesmo tempo e o seletor de datas parecia não funcionar.
    canMarketing && ehAba("meta")
      ? comTimeout(
          getMetaDetail({
            brand,
            range: one(sp.range),
            since: one(sp.since),
            until: one(sp.until),
          }),
          T_LENTO,
          "meta-detail",
        )
      : Promise.resolve(null),
    canMarketing && ehAba("meta")
      ? comTimeout(
          getMetaBreakdowns({
            brand,
            range: one(sp.range),
            since: one(sp.since),
            until: one(sp.until),
          }),
          T_LENTO,
          "meta-breakdowns",
        )
      : Promise.resolve(null),
    // Os quatro leitores do Instagram recebem o MESMO filtro da tela. Antes cada
    // um tinha janela fixa própria (histórico / 28d / 14d / 24h) e o seletor de
    // período não governava nada — o mesmo defeito corrigido no Meta Ads.
    ...(() => {
      const janelaIg = {
        brand,
        range: one(sp.range),
        since: one(sp.since),
        until: one(sp.until),
      };
      const seAba = <T,>(p: () => Promise<T>, ms: number, rot: string) =>
        canMarketing && ehAba("instagram")
          ? comTimeout(p(), ms, rot)
          : Promise.resolve(null);
      return [
        seAba(() => getInstagramOverview(janelaIg), T_RAPIDO, "ig-overview"),
        seAba(() => getInstagramFunnel(janelaIg), T_LENTO, "ig-funnel"),
        seAba(() => getInstagramAudience(janelaIg), T_RAPIDO, "ig-audience"),
        seAba(() => getInstagramStories(janelaIg), T_RAPIDO, "ig-stories"),
      ] as const;
    })(),
    canGa4 && ehAba("ga4") ? comTimeout(getGa4Overview(), T_LENTO, "ga4-overview") : Promise.resolve(null),
    canGa4 && ehAba("ga4") ? comTimeout(getGa4Realtime(), T_RAPIDO, "ga4-realtime") : Promise.resolve(null),
    canMarketing && ehAba("youtube") ? comTimeout(getYoutubeOverview({ brand }), T_RAPIDO, "youtube") : Promise.resolve(null),
    // Também na aba INSTAGRAM: o painel de lá mostra o progresso da meta de
    // seguidores ao lado de cada marca. Sem isso era preciso trocar de aba só
    // para saber se o número é bom.
    canMarketing && (ehAba("metas") || ehAba("instagram"))
      ? comTimeout(getMetasComAtual(competencia), T_RAPIDO, "metas")
      : Promise.resolve(null),
    canMarketing && ehAba("youtube") ? comTimeout(listarConexoes(), T_RAPIDO, "yt-conexoes") : Promise.resolve(null),
    // ~12 consultas ao Google (em paralelo dentro da função) + títulos dos
    // vídeos pela Data API. Janela maior que T_LENTO porque é a leitura externa
    // mais pesada da página.
    canMarketing && ehAba("youtube")
      ? comTimeout(detalheDoCanal(ytCanal, janelaDias(ytDias)), T_YOUTUBE, "yt-analytics")
      : Promise.resolve(null),
    canCac && ehAba("cac")
      ? comTimeout(
          getCompanyId().then((companyId) =>
            companyId ? getCac(companyId, { mes: cacMes }) : null,
          ),
          T_LENTO,
          "cac",
        )
      : Promise.resolve(null),
  ]);
  const allBrands = MARKETING_AD_ACCOUNTS.map((a) => a.label);

  return (
    <MarketingShell
      // Permissão, não presença de dado: os slots das abas inativas são `null`
      // por desenho, e o dock precisa continuar completo mesmo assim.
      disponivel={{
        painel: canMarketing,
        meta: canMarketing,
        metas: canMarketing,
        instagram: canMarketing,
        ga4: canGa4,
        youtube: canMarketing,
        cac: canCac,
      }}
      painel={painel ? <MarketingPainel data={painel} /> : null}
      meta={
        marketing ? (
          <div className="flex flex-col gap-8">
            <MarketingMetrics
              data={marketing}
              allBrands={allBrands}
              basePath="/marketing"
              aba="meta"
            />
            {metaDetail ? (
              <>
                <hr className="border-border" />
                <MetaDetailMetrics data={metaDetail} />
              </>
            ) : null}
            {metaBreakdowns ? (
              <>
                <hr className="border-border" />
                <MetaBreakdownsPanel data={metaBreakdowns} />
              </>
            ) : null}
          </div>
        ) : null
      }
      instagram={
        instagram ? (
          <InstagramMetrics
            data={instagram}
            funnel={igFunnel}
            audience={igAudience}
            stories={igStories}
            metas={metas}
          />
        ) : null
      }
      ga4={ga4 ? <Ga4Metrics data={ga4} realtime={ga4Realtime} /> : null}
      youtube={
        youtube ? (
          <div className="flex flex-col gap-6">
            <YoutubeConexoes
              conta={contaYoutube(ytConexoes)}
              canais={CANAIS_YOUTUBE}
              podeGerenciar={can(ctx, "marketing", "gerenciar")}
            />
            {ytAnalytics ? (
              <YoutubeAnalyticsPanel
                detalhe={ytAnalytics}
                canais={CANAIS_YOUTUBE}
                dias={ytDias}
              />
            ) : null}
            <YoutubeMetrics data={youtube} />
          </div>
        ) : null
      }
      metas={
        metas ? (
          <MarketingMetasPanel
            metas={metas}
            competencia={competencia}
            competencias={competencias}
            podeEditar={can(ctx, "marketing", "gerenciar")}
          />
        ) : null
      }
      cac={cac ? <CacMetrics data={cac} mes={cacMes} /> : null}
    />
  );
}
