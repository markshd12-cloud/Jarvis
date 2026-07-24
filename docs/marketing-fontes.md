# Marketing — Catálogo de dados por fonte

Referência do que **cada fonte expõe**: o que já puxamos, o que dá pra adicionar
(sem custo, mesma API) e os ajustes de tracking necessários do lado do cliente.
Complementa `marketing-status.md` (roadmap) e `backlog.md`. Atualizado 2026-07-20.

Legenda: ✅ já integrado · ➕ dá pra adicionar · ⚙️ depende de configuração do cliente.

---

## 1. GA4 — Google Analytics 4 (site)

- **API:** Google Analytics **Data API v1** (`analyticsdata.googleapis.com` → `:runReport`).
- **Auth:** service account do Vertex (`GOOGLE_SERVICE_ACCOUNT_JSON`) c/ acesso Leitor · escopo `analytics.readonly`.
- **Propriedade:** `545839732` (`GA4_PROPERTY_ID` em `lib/marketing/config.ts`). Vários domínios numa
  propriedade só (cppem.com.br, pmpe.cppem.com.br, captura.*, colegio.*, unicive.* …).

### Já puxamos ✅
- Totais 28d: `sessions`, `totalUsers`, `newUsers`, `screenPageViews`, `conversions`,
  `engagementRate`, `averageSessionDuration`.
- `sessionDefaultChannelGroup` × sessões (canais).
- **`hostName` × sessões/usuários** (sessões por SITE — resolve o "/" ambíguo do multi-domínio).
- Série diária (`date` × sessions/users).
- Top páginas **com host** (`hostName` + `pagePath`).

### Dá pra adicionar ➕ (mesma API)
- **Métricas:** `engagedSessions`, `bounceRate`, `eventCount`, `keyEvents`, `sessionsPerUser`,
  `screenPageViewsPerSession`, `userEngagementDuration`, `totalRevenue`/`purchaseRevenue` (se e-commerce).
- **Dimensões:** `landingPage` (página de entrada), `sessionSource`/`sessionMedium`/`sessionCampaignName`
  (atribuição fina), `deviceCategory`, `country`/`region`/`city`, `newVsReturning`, `dayOfWeekName`/`hour`,
  `eventName` (eventos específicos), `sessionGoogleAdsCampaignName` (se GA4 ligado ao Google Ads).
- **Realtime API** (`:runRealtimeReport`): usuários ativos agora.

### Ajustes de tracking ⚙️ (lado do cliente, via GTM)
- **Conversões = 0 hoje (CONFIRMADO no probe 2026-07-21: `keyEvents`=0)** → só disparam `page_view`/
  `session_start`/`first_visit`/`user_engagement`. Marcar **eventos-chave (key events)** no GA4: clique
  WhatsApp, envio de formulário, matrícula. Sem isso, "Conversões" e CPL por canal não valem. **Ação do cliente.**
- **"Unassigned" alto** = campanhas sem **UTM**. Padronizar UTMs melhora a atribuição por canal.
- **Cross-domain measurement** (GTM/GA4): se `captura.cppem` → `cppem.com.br` é a MESMA jornada,
  configurar p/ não abrir sessão nova ao trocar de subdomínio. Se são sites independentes, o `hostName` já basta.
- (Opcional) custom dimension "site/marca" no GTM p/ rotular além do hostName.

---

## 2. Meta Ads (Facebook/Instagram Ads) — mídia paga

- **API:** Graph/Marketing API `v25.0` (`graph.facebook.com`). Auth: System User token (`META_ACCESS_TOKEN`),
  escopos `ads_read` + `read_insights`. 4 contas de anúncio (CPPEM Concursos, Unicive, Colégio, Everton).

### Já puxamos ✅ (nível CONTA)
- `spend`, `impressions`, `clicks`, `reach`, `ctr`, `cpc`, `cpm`.
- Ações: `lead`, `onsite_conversion.messaging_conversation_started_7d` (conversas), `purchase`.

### Dá pra adicionar ➕
- **Quebra por nível:** Campanha / Conjunto (adset) / Anúncio (`level=campaign|adset|ad`) →
  top campanhas e anúncios, não só a conta.
- **Breakdowns:** `age`, `gender`, `publisher_platform`+`platform_position` (feed/stories/reels/AN),
  `impression_device`, `region`/`country`.
- **Métricas de resultado:** `purchase_roas` (ROAS), `cost_per_action_type` (CPL / custo por conversa /
  custo por compra), `action_values` (valor/receita de conversão), `frequency`, `unique_clicks`, `cpp`.
- **Vídeo:** `video_thruplay_watched_actions`, `video_30_sec_watched_actions`, `cost_per_thruplay`.
- **Qualidade do anúncio:** `quality_ranking`, `engagement_rate_ranking`, `conversion_rate_ranking`.
- **Série temporal** por campanha (`time_increment=1`).

---

## 3. Instagram — orgânico

- **API:** Graph API (mesmas credenciais do Meta). Contas business por marca. Volume pequeno (~25 posts/conta).

### Já puxamos ✅
- Seguidores por marca + **curva de crescimento** (via snapshots diários).
- Posts recentes: `likes`, `comments`, `saved`, `shares`, `reach` + engajamento; melhores por engajamento.

### Dá pra adicionar ➕
- **Insights de CONTA** (`/{ig-user}/insights`): `profile_views`, `website_clicks`, `accounts_engaged`,
  `reach`/`impressions` (nível conta), `follower_count`.
- **Demografia dos seguidores:** `follower_demographics` (idade, gênero, cidade, país), `online_followers`
  (horários com mais seguidores online → melhor horário de post).
- **Reels:** `plays`, `ig_reels_avg_watch_time`, `ig_reels_video_view_total`.
- **Stories:** `exits`, `replies`, `taps_forward`/`taps_back`, `impressions`/`reach` por story.

---

## 4. YouTube — a integrar (Passos 7-8 do roadmap)

- **Nível A (público) — YouTube Data API v3** (`youtube.googleapis.com`), auth por **API key**:
  - Canal: `viewCount`, `subscriberCount`, `videoCount`.
  - Vídeos: views, likes, comentários, top vídeos.
  - ⚙️ Precisa: **Channel ID** + **API key**.
- **Nível B (analytics do dono) — YouTube Analytics API** (`youtubeAnalytics.googleapis.com`),
  auth **OAuth do dono** (service account não serve; escopo `yt-analytics.readonly`):
  - `estimatedMinutesWatched` (watch time), `averageViewDuration`, `averageViewPercentage` (retenção),
    `subscribersGained/Lost`, `estimatedRevenue` (se monetizado), origens de tráfego, demografia.
  - ⚙️ Precisa: autorizar OAuth 1x (fluxo igual Notion/Conta Azul).
- Nota: o JWT `node:crypto` do `ga4.ts` já serve p/ APIs Google — o nível A (API key) é o mais rápido.

---

## 5. TikTok — a integrar (Passo 9 do roadmap)

- **Ads — TikTok Marketing/Business API** (`business-api.tiktok.com`), auth OAuth do anunciante
  (app no TikTok for Business):
  - `spend`, `impressions`, `clicks`, `conversions`, `cpc`, `cpm`, `ctr`, `cost_per_conversion`.
- **Orgânico — TikTok Business Account API:**
  - Conta: `video_views`, `profile_views`, `follower_count`, `likes`, `comments`, `shares`.
  - Vídeos: views, engajamento, tempo médio assistido.
- ⚙️ Precisa: decidir **Ads e/ou orgânico**; criar app dev no TikTok for Business; autorizar OAuth;
  (Ads) `advertiser_id`.
- Esforço MÉDIO/ALTO (registro de app + revisão do TikTok).

---

## Como cada fonte entrega (resumo)

| Fonte | Auth | Modo | Segredo/ID p/ ligar |
|---|---|---|---|
| GA4 | Service account (Vertex) | ao vivo (cache 10min) | Property ID ✅ |
| Meta Ads | System User token | sync → tabela | `META_ACCESS_TOKEN` ✅ |
| Instagram | idem Meta | sync → tabela | idem ✅ |
| YouTube A | API key | ao vivo | Channel ID + API key ⚙️ |
| YouTube B | OAuth (dono) | ao vivo | autorização OAuth ⚙️ |
| TikTok | OAuth (advertiser) | ao vivo/sync | app dev + OAuth + advertiser_id ⚙️ |
