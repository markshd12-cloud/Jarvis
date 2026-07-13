# Roadmap — enriquecimento de dados de Marketing (Meta)

Estado atual (no ar): Meta Ads nível conta/dia (`spend, impressions, clicks,
reach, ctr, cpc, cpm`), dashboard filtrado (período/marca) com KPIs+deltas,
tendência e pizza; chat período-aware. Fonte de verdade: `lib/marketing/metrics.ts`.

Ordem de execução acordada: **Instagram orgânico (Fase C) primeiro**, depois
1 → 2 → 4 → 5. Cada fase: implementar → o usuário valida testando → seguir.

## Pré-requisito (bloqueia C e D): escopos do token
System User token precisa de, além de `ads_read`: `read_insights`,
`instagram_basic`, `instagram_manage_insights`, `pages_read_engagement`,
`business_management`. Validar no App Meta e regravar em `marketing_connections`.

---

## Fase C — Instagram orgânico (EM ANDAMENTO)
IG Graph API; IDs já em `config.ts` (`instagram[]` por marca). Precisa que cada
IG Business Account esteja vinculado a uma Página e ao token.

- **Migration 0021**: `social_daily_insights` (snapshot diário por conta:
  followers, reach, views, profile_views, website_clicks, accounts_engaged) +
  `social_media_insights` (por post/reel/story: reach, saved, shares, likes,
  comments, views, posted_at, permalink, type). RLS sem policies (service_role).
- **`lib/marketing/instagram.ts`**: fetch defensivo (métricas do IG mudam de
  versão — ex.: `impressions`→`views` no v22+; tolerar falha por métrica).
  - Conta: nó `?fields=followers_count,media_count,username` (total estável) +
    `/insights?metric=reach,profile_views,website_clicks,...&period=day`.
  - Mídia: `/media?fields=...` recente + `/{media}/insights` por tipo.
- **Sync**: `syncInstagram()` chamado pela mesma rota `/api/marketing/sync`
  (roda após o Meta Ads); respeita `?days=`.
- **Read**: `lib/marketing/social.ts` — `getInstagramOverview()` (crescimento de
  seguidores + KPIs) e `getTopMedia()`.
- **UI**: seção "Instagram orgânico" no dashboard (seguidores + sparkline + top
  posts), espelhando o mockup.
- **Chat**: resumo orgânico em `marketing-context.ts`.
- **Testar**: rodar sync, conferir contagem retornada e a seção no painel;
  primeiro gate real = o token/escopos deixam a IG Graph API responder.

## Fase 1 — Conversões & ROI (Meta Ads)
Mesmo endpoint; preenche a coluna `conversions` (hoje null).
- `config.ts`: `META_INSIGHT_FIELDS` += `actions, action_values,
  cost_per_action_type, purchase_roas`.
- `meta.ts`: `parseActions()` mapeia `action_type` (`lead`,
  `onsite_conversion.messaging_conversation_started_7d`, `purchase`,
  `landing_page_view`) → colunas.
- **Migration 0022**: `add column leads int, conversations int, purchases int,
  conversion_value numeric`.
- `metrics.ts`: agrega + deriva CPL (`spend/leads`) e ROAS
  (`conversion_value/spend`).
- UI: KPIs Leads, CPL, Conversas; Chat inclui.
- **Definir com o cliente**: objetivo de conversão real (lead / conversa
  WhatsApp / compra pixel) → define o mapeamento e o KPI de destaque.

## Fase 2 — Breakdowns (plataforma/campanha)
Granularidade nova → tabela separada.
- **Migration 0023**: `marketing_ad_insights(date, brand, campaign_id,
  campaign_name, adset_id, ad_id, publisher_platform, platform_position,
  spend, impressions, clicks, leads, conversion_value, ...)` + índices.
- `meta.ts`: `fetchAdInsights()` com `level=ad` +
  `breakdowns=publisher_platform,platform_position` (paginação; volume 10–50×).
- UI: barras por plataforma (Feed/Stories/Reels), donut IG×FB, tabela de
  campanhas com status. Chat: top-N campanhas resumidas.
- Aqui a RPC de agregação do `0020` passa a valer a pena.

## Fase 4 — Facebook Page orgânico
Reusa `social_daily_insights` com `provider='facebook_page'`;
`fetchPageInsights()` (`page_fans, page_impressions, page_engaged_users`).
Espelha a Fase C. Menor prioridade.

## Fase 5 — Estrutura/gestão de contas
Nomes/status/orçamento/objetivo de campanhas e adsets; saldo e status da conta.
Enriquece contexto do chat ("campanha X ativa com R$ Y/dia") e o drill-down.

---

## Transversais
- **Cron**: com várias fases o sync engorda → agendar 1–2×/dia
  (`x-cron-secret`, já aceito pela rota).
- **Chat token-budget**: `buildMarketingBlock` cresce → manter resumos.
- **Migrations**: rodadas manuais no SQL Editor (convenção 0019).
- **Turbopack**: módulo/arquivo novo exige restart do `npm run dev`.
