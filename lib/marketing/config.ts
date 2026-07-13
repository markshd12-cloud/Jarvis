/**
 * Escopo da integração de Marketing — Meta Ads (Marketing API v25.0, 2026).
 *
 * Apenas constantes/config, SEM I/O. Diferente da Conta Azul (escopada por
 * empresa), o marketing é GLOBAL: o time trabalha as marcas de forma unificada,
 * então os dados são compartilhados no workspace e o acesso é por permissão
 * ("marketing"), não por company_id.
 *
 * Um único App Meta (APP_ID/SECRET/token) cobre as 4 contas de anúncio. Os
 * segredos vêm do ambiente (`.env.local` / secrets), NUNCA daqui nem do git —
 * mesmo padrão da service account do Vertex. Os dados são estruturados e vão
 * para o DASHBOARD (não RAG).
 *
 * GA4 fica para uma fase posterior (reusará a service account do Vertex).
 */

/** Versão da Graph/Marketing API. */
export const META_API_VERSION = "v25.0";
export const META_GRAPH_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

/** Credenciais do App Meta. Configurar no `.env.local` (nunca commitar). */
export const META_ENV = {
  appId: process.env.META_APP_ID ?? "",
  appSecret: process.env.META_APP_SECRET ?? "",
  /** User/System User token com escopos ads_read + read_insights. */
  accessToken: process.env.META_ACCESS_TOKEN ?? "",
} as const;

/**
 * Marcas monitoradas. Uma conta de anúncio por marca, todas sob o mesmo App.
 * `label` é gravado na coluna `brand` de marketing_daily_insights (null lá =
 * agregado geral de todas as marcas). IG/FB ficam registrados para uso futuro
 * (métricas orgânicas/sociais), fora do escopo da Fase 1.
 */
export interface MarketingBrand {
  /** Rótulo exibido no dashboard e gravado em `brand`. */
  label: string;
  /** Ad Account da Meta (formato act_...). */
  adAccountId: string;
  /** Instagram Business Account(s) — uso futuro. */
  instagram: string[];
  /** Facebook Page — uso futuro. */
  facebookPage: string | null;
}

export const MARKETING_BRANDS = {
  cppemConcursos: {
    label: "CPPEM Concursos",
    adAccountId: "act_872192120930966",
    instagram: ["17841424910850559"],
    facebookPage: "124001460793885",
  },
  unicive: {
    label: "Unicive",
    adAccountId: "act_345492055179709",
    instagram: ["17841449797943607"],
    facebookPage: "308583202333132",
  },
  colegio: {
    label: "Colégio",
    adAccountId: "act_587296211099482",
    instagram: ["17841408638987215"],
    facebookPage: "306424352558530",
  },
  everton: {
    label: "Everton",
    adAccountId: "act_687701173447585",
    instagram: ["17841404986383024", "17841465120978766"],
    facebookPage: null,
  },
} satisfies Record<string, MarketingBrand>;

/** Lista das contas para iterar no sync (com o rótulo de marca de cada uma). */
export const MARKETING_AD_ACCOUNTS = Object.values(MARKETING_BRANDS);

/** Campos de insights por dia (nível de conta = "dados gerais"). */
export const META_INSIGHT_FIELDS = [
  "spend",
  "impressions",
  "clicks",
  "reach",
  "ctr",
  "cpc",
  "cpm",
] as const;

/** Provedores válidos (chave de marketing_connections). GA4 entra depois. */
export type MarketingProvider = "meta_ads" | "ga4";
