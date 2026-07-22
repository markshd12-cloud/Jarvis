# Módulo Marketing — Status & Roadmap

Fonte única de "onde estamos" no Marketing. Espelha o `financeiro-status.md`.
Atualizado 2026-07-20.

## Arquitetura

- **Página própria `/marketing`** (item de sidebar, como o Financeiro), com **dock
  de sub-abas** (`app/(app)/marketing/marketing-shell.tsx`). Cada aba pronta é
  buscada no servidor (`page.tsx`) conforme a permissão e passada ao shell como slot.
- **GLOBAL** (sem `company_id`): o marketing trabalha as 4 marcas (CPPEM Concursos,
  Unicive, Colégio, Everton) de forma unificada. O gate é por permissão.
- **Permissões (matriz de roles em Empresas):**
  - `marketing` (ver/gerenciar) → Meta Ads + Instagram.
  - `ga4` (ver) → aba GA4. **Checkbox próprio** ("quem pode ver o GA4").
  - Sidebar "Marketing" aparece p/ quem tem `marketing` **ou** `ga4` (link `anyOf`).
- **Dados:** Meta/Instagram sincronizam p/ tabelas (`marketing_daily_insights`,
  `social_*`) e o painel LÊ delas; GA4 lê **ao vivo** da API (cache 10 min), sem tabela.

## Feito e validado

| Passo | O quê | Estado |
|---|---|---|
| 1 | **Fundação** — App Meta (4 contas), `lib/marketing/config.ts` (marcas, campos), `MarketingProvider` | ✅ prod |
| 2 | **Meta Ads** — insights diários (spend/impr/clicks/CTR/CPC/CPM + ações: lead/conversa/compra), sync (`POST /api/marketing/sync`, cron `x-cron-secret`), painel `MarketingMetrics` | ✅ prod |
| 3 | **Instagram orgânico** — seguidores por marca, curva de crescimento, posts + engajamento (`social.ts`, `InstagramMetrics`); roda junto do sync do Meta | ✅ prod |
| 4 | **Cron de sync** — `jarvis-cron.sh marketing` de 6/6h na VPS | ✅ prod |
| 5 | **GA4 (Google Analytics)** — Data API v1 ao vivo, auth via JWT `node:crypto` reusando a service account do Vertex; overview (sessões/usuários/pageviews/conversões/engajamento + série diária + canais + top páginas); permissão `ga4` | ✅ IMPLEMENTADO (2026-07-20), validado ao vivo (Property `545839732`), falta deploy |
| 6 | **Página `/marketing` + dock + sidebar** — módulo dedicado espelhando o Financeiro; Meta/Instagram/GA4 como abas; permissão `marketing`/`ga4` | ✅ IMPLEMENTADO (2026-07-20), falta deploy |
| M1 | **Meta detalhe — Fase 1** — leitura AO VIVO por CAMPANHA e ANÚNCIO (cache 10min), top por investimento com CPL, custo por conversa (WPP) e ROAS. `lib/marketing/meta-detail.ts` + `MetaDetailMetrics`, na aba Meta abaixo do overview, respeita o filtro de marca | ✅ IMPLEMENTADO (2026-07-21), falta deploy |

## Expansão do Meta Ads (faseada)

> Tudo reusa o MESMO token/escopos (`ads_read`+`read_insights`) — zero setup novo.
> Volume por-nível é grande → **ao vivo com cache** (como o GA4), NÃO sync diário.

| Fase | Entrega | Estado |
|---|---|---|
| **1 · Performance** | Top **campanhas** e **anúncios** com CPL, custo/conversa, ROAS, CTR (o "onde investir"). Cards em GRADE clicáveis → Gerenciador de Anúncios | ✅ implementado (M1, 2026-07-21) |
| **2 · Breakdowns** | Segmentação por `age`, `gender`, `publisher_platform`+`platform_position` (feed/stories/reels/AN), `impression_device`, `region`, com investimento + CPL por segmento | ✅ implementado (2026-07-21) — `getMetaBreakdowns` + `MetaBreakdownsPanel` |
| **3 · Criativo + qualidade** | Miniatura/título do anúncio (creative) nos cards + rankings `quality_ranking`/`engagement_rate_ranking`/`conversion_rate_ranking` como badges | ✅ implementado (2026-07-21) |

Notas da expansão:
- **Fase 2 (feito):** 4 requests/conta (idade+gênero num só cruzado, plataforma+posição, dispositivo,
  região). Agrega across contas, ordena por gasto, CPL por segmento. Barras por card.
- **Fase 3 (feito):** rankings vêm nos fields de insights de anúncio (0 request extra); o criativo
  (thumbnail+título) sai de **1 batch** `GET /?ids=<top ads>&fields=creative{...}` (só dos anúncios
  exibidos). `<img>` simples (sem next/image → sem config de remotePatterns). Rankings só com volume
  ≥500 impressões/7d, senão "unknown" (badge some). Cards de anúncio ganham miniatura + badges.
- **Carga (resolvido):** o `/marketing` faz ~24 requests à Graph por load FRIO (8 detalhe + 16
  breakdown). Agora atrás de um **cache SWR de 2 camadas** (`lib/cache/kv.ts`): L1 memória + **L2
  Supabase `cache_kv`** (migration **0026**, persistente/compartilhado). O cold load caro roda no
  máximo 1× a cada 10 min GLOBALMENTE — e sobrevive a redeploy/restart (antes o Map de processo
  zerava a cada deploy). SWR = nunca faz o usuário esperar após a 1ª vez (revalida em background).
  Degrada gracioso se a 0026 não estiver aplicada (cai p/ só-L1). GA4/painel financeiro seguem
  L1-only (leituras mais leves) — podem adotar o L2 depois se precisar.

## Expansão do Instagram orgânico (faseada)

> Mesmo token/escopos (`instagram_basic`+`instagram_manage_insights`) — zero setup novo.
> Sync→tabela (como o resto do IG), lido no /marketing. ⚠️ Não testado ao vivo (sem token local).

| Fase | Entrega | Estado |
|---|---|---|
| **1 · Funil da conta** | Alcance → engajaram → visitaram o perfil → cliques no link da bio, com taxas de conversão (+ impressões/interações) | ✅ implementado (2026-07-21) — `getInstagramFunnel` + `InstagramFunnelPanel`, AO VIVO c/ cache |
| **2 · Demografia + horário** | Idade/gênero/cidade/país dos seguidores (`follower_demographics`) + melhor horário (`online_followers`) | ✅ implementado (2026-07-21) — tabela `social_audience` (migration **0027**) |
| **3 · Formato + stories** | Desempenho por formato (Reels×Carrossel×Imagem, agregação) + stories (alcance/respostas/navegação) | ✅ implementado (2026-07-21) |

Notas:
- **Fase 2:** demografia exige **≥100 seguidores** (senão a métrica volta vazia → card some). `social_audience`
  é snapshot (formato longo: breakdown/segment/value/captured_on); o leitor usa o snapshot mais recente por
  conta. `online_followers` é best-effort (mudou entre versões).
- **Fase 3:** formato = pura agregação dos posts (0 request extra). Stories entram em `social_media_insights`
  (product_type STORY, métricas no jsonb `metrics`). ⚠️ **Story some em 24h** → o cron de 6/6h captura cada
  story algumas vezes; o último snapshot antes de expirar é o mais completo (pode perder as horas finais). Se
  precisar de precisão, criar um sync de stories mais frequente.
- **Funil (Fase 1, adiado):** mostraria quantos, do alcance, veem o perfil e clicam no link da bio (tráfego IG→site).

## Falta fazer

### Fase 2 — Novos canais
- **Passo 7 · YouTube (nível A — público)** — YouTube Data API v3 com **API key**:
  views, inscritos, stats por vídeo, top vídeos. **Precisa do usuário:** Channel ID + API key.
  Esforço BAIXO. Aba `youtube` já existe como "(em breve)".
- **Passo 8 · YouTube (nível B — analytics do dono)** — YouTube Analytics API (watch time,
  retenção, receita, origens): **OAuth do dono do canal** (service account não serve). Esforço MÉDIO.
- **Passo 9 · TikTok** — Ads (TikTok Marketing API) e/ou Orgânico (Business Account API):
  spend/conversões e views/seguidores/engajamento. **OAuth via TikTok for Business** (app dev +
  autorização). **Precisa do usuário:** decidir Ads e/ou orgânico + criar app + autorizar. Esforço MÉDIO/ALTO.

### Fase 3 — Consolidação
- **Passo 10 · Painel consolidado** — visão geral cross-channel (investimento×resultado, funil,
  distribuição por canal/marca, alertas). Aba `painel` já existe como "(em breve)". Ver mockup
  publicado (design de referência).
- **Passo 11 · Comparativo entre canais** — CPL/ROAS/leads por canal lado a lado. Aba `comparativo`.
- **Passo 12 · Modo TV** — tela cheia + carrossel (reusar o padrão do `painel-tv.tsx` do Financeiro).
- **Passo 13 · Contexto no chat** — perguntas de marketing usam GA4/YouTube/TikTok
  (`lib/ai/marketing-context.ts` hoje cobre Meta).

## Padrão para adicionar um canal novo (checklist)
1. `lib/marketing/<canal>.ts` (server-only): fetch + normalizar. Ao vivo (cache) OU sync p/ tabela.
2. Se sync: rota no `POST /api/marketing/sync` + (opcional) tabela.
3. `components/<canal>-metrics.tsx`: painel (KPIs + gráficos do kit `components/charts/*`).
4. Aba no `marketing-shell.tsx` (`ready:true`) + slot no `page.tsx` (gated por permissão).
5. Permissão: feature nova em `lib/permissions.ts` (vira checkbox na matriz) OU reusar `marketing`.
6. (Opcional) contexto no chat (`marketing-context.ts`).

## Notas / débitos
- **Segredos p/ novos canais** (YouTube API key, TikTok app secret) → env + `.env.production` + redeploy.
- **Auth Google reutilizável:** o JWT `node:crypto` do `ga4.ts` serve p/ qualquer API Google (YouTube
  Data/Analytics) — só trocar o `scope`.
- **`.next` corrompe em dev** (sequência de restarts) → `rm -rf .next` + restart.
- Rotacionar segredos expostos (ver `backlog.md`).
