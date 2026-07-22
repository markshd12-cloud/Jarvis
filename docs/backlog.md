# Backlog & Pendências — Jarvis

Visão consolidada do que falta, débitos técnicos e melhorias. Detalhe do módulo
financeiro em `financeiro-status.md`. Atualizado 2026-07-20.

---

## 🔴 Segurança (prioridade imediata)

- **Rotacionar segredos expostos (2026-07-20).** Durante um deploy, valores de
  segredos apareceram em texto puro no output. Rotacionar:
  | Segredo | Onde rotacionar | Depois |
  |---|---|---|
  | `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API (roll key) | atualizar `.env.production` + redeploy env-only |
  | `CONTA_AZUL_CLIENT_SECRET` | Portal de devs Conta Azul | idem (e revalidar OAuth) |
  | `META_ACCESS_TOKEN` | Meta Business (System User token) | idem |
  | `GOOGLE_SERVICE_ACCOUNT_JSON` (private_key) | GCP → IAM → Service Accounts → nova key | idem |
  | `VAPID_PRIVATE_KEY` | regerar par VAPID | idem (chave pública é build-arg) |
  | `CRON_SECRET` | gerar novo (`openssl rand -hex 32`) | idem |
  - Fluxo do redeploy env-only: editar `.env.production` no servidor → `docker stack deploy`
    (a seção environment muda o spec → recria a task). Ver `financeiro-status.md`/memória de deploy.

---

## 🟢 Financeiro — features que faltam

- **Passo 17 · Produtos & Serviços** (baixa prioridade) — read `/produtos` + `/servico`
  do CA: itens vendáveis, tipo, preço, vendas/ano, receita. É o ÚNICO passo de feature
  que resta (1–16 + Painel/TV entregues).
- **Passo 11 · Import mapear centro/BU** — 📅 **agendado p/ início do próximo mês**
  (decisão do usuário: quando o lançamento de despesa migrar do CA pro Jarvis). O
  `import-despesas.ts` deve passar a setar `centro_custo_id` (de `centros_de_custo[0].id`
  → casa por `ca_centro_id`, já corrigido no Passo 2) e `bu_id` (regra a definir), + backfill
  das despesas já importadas.

---

## 🟡 Débitos técnicos

- **Despesa por BU/centro nas NOSSAS tabelas = vazia** (tudo "Geral"/"Sem centro") até o
  Passo 11. Hoje: % Centro de Custo e Painel leem despesa do **CA ao vivo** (correto);
  "despesa por BU" no Painel fica de fora. Passo 2 (seed de centros) já foi CORRIGIDO.
- **Cron de automação financeira** — sync de receita (Passo 10) + materialização de
  recorrências (Passo 8) hoje são **botões manuais**. Poderiam virar cron (infra de cron já
  existe: `jarvis-cron.sh` na VPS; hoje roda marketing + notion).
- **Clientes v2** — adicionar `documento` (CPF/CNPJ) e `BU principal` via `/pessoa` (ficou
  fora do v1 porque o token do CA expirou durante o build).
- **Export pra Conta Azul** — gerar planilha no formato `Planilha_Modelo_ContaAzul.xls`
  (reversibilidade "voltar pro CA").
- **Lint `react-hooks/set-state-in-effect`** — dívida PRÉ-EXISTENTE em vários painéis
  (`receita-panel` e cia): `void refetch()` no `useEffect`. Padronizar quando tocar.
- **`.next` corrompendo em dev** — sequência de restarts do `next dev` corrompe o manifest
  (`routes.d.ts`) → `rm -rf .next` + restart resolve. (Só dev; o build de prod é limpo.)

---

## 🔵 Melhorias / ideias

- **Cache SWR** (feito 2026-07-20) — `lib/financeiro/cache.ts` serve instantâneo + revalida
  em background nas 5 fontes pesadas. Evolução: cache compartilhado (Supabase/Redis) se
  escalar p/ 2+ réplicas.
- **Dashboard TV** — mais telas (BU, centro), transições animadas, configurar ordem/tempo,
  entrar via URL `?tv=1`, `wakeLock`. Hoje: 4 telas (Visão Geral, Receita×Despesa, Vendas,
  Inadimplência), 10s, fullscreen.
- **Marketing — novas fontes: TikTok, GA4, YouTube** (pesquisa — ver seção abaixo).

---

## 📣 Marketing — expansão de fontes (TikTok · GA4 · YouTube)

> **Mapa de passos: `docs/marketing-status.md` · Catálogo do que cada fonte expõe: `docs/marketing-fontes.md`.** Já feito (2026-07-20, falta deploy):
> página própria **`/marketing`** (sidebar + dock, espelha o Financeiro), **GA4 integrado** (ao vivo,
> permissão `ga4` com checkbox próprio), Meta/Instagram migrados p/ a página. Falta: YouTube, TikTok,
> Painel consolidado, Comparativo, Modo TV.

Contexto: marketing é GLOBAL (workspace), gated por `marketing`, dados estruturados em
`marketing_daily_insights` (coluna `brand`) → Dashboard. `MarketingProvider = "meta_ads" | "ga4"`
(GA4 já previsto). Padrão de sync: rota `POST /api/marketing/sync` (cron `x-cron-secret`) itera
as contas e faz upsert diário. As 3 fontes entram como novos providers no mesmo modelo.

### 1) GA4 (Google Analytics 4) — ✅ VIÁVEL, o mais fácil
- **API:** Google Analytics **Data API v1** (`analyticsdata.googleapis.com` → `:runReport`).
- **Auth:** **REUSA a service account do Vertex** (`GOOGLE_SERVICE_ACCOUNT_JSON`) — só adicionar
  o `client_email` da SA como **Viewer** na propriedade GA4 (Admin → Property Access Management).
  Escopo `analytics.readonly`. **Sem OAuth.** (`google-auth-library` já é dep do projeto.)
- **Dados:** sessões, usuários, pageviews, conversões, origem/mídia, campanha, página, device,
  país, eventos — por dia e dimensões.
- **Precisa de você:** o **GA4 Property ID** (numérico) + conceder acesso à SA.
- **Esforço:** BAIXO. Config já planejava. **Recomendado começar por aqui.**

### 2) YouTube — ✅ VIÁVEL em 2 níveis
- **Nível A (público, fácil):** **YouTube Data API v3** (`youtube.googleapis.com`) com **API key** —
  views, inscritos, likes/comentários do canal e por vídeo (top vídeos). Bom p/ um "overview do canal".
- **Nível B (analytics do dono, médio):** **YouTube Analytics API** (`youtubeAnalytics.googleapis.com`)
  — watch time, retenção, inscritos ganhos, receita, origens de tráfego, demografia. Exige **OAuth 2.0
  com o dono do canal** (escopo `yt-analytics.readonly`); service account NÃO serve (salvo Brand account
  em Workspace com delegação). Mesmo padrão de OAuth que já temos (Notion/Conta Azul).
- **Precisa de você:** o **Channel ID** (+ API key p/ nível A); p/ nível B, autorizar 1x o OAuth.
- **Esforço:** BAIXO (nível A) / MÉDIO (nível B). Sugestão: começar pelo A, evoluir p/ B se precisar de
  watch time/receita.

### 3) TikTok — ✅ VIÁVEL, mais setup
- **Ads (se rodam TikTok Ads):** **TikTok Marketing/Business API** (`business-api.tiktok.com`) —
  spend, impressões, clicks, conversões, CPC/CPM. Auth: app no **TikTok for Business** + OAuth do
  anunciante (análogo ao Meta Ads).
- **Orgânico:** **TikTok Business Account API** (insights de conta/posts: views, seguidores,
  engajamento) — OAuth de conta business.
- **Precisa de você:** decidir **Ads e/ou Orgânico**; criar o app dev no TikTok for Business;
  autorizar OAuth (advertiser/business).
- **Esforço:** MÉDIO/ALTO (registro de app + OAuth + revisão do TikTok). Mais pesado que GA4/YouTube.

### Como encaixa (mesmo modelo do Meta)
- Estender `MarketingProvider` → `"meta_ads" | "ga4" | "youtube" | "tiktok"`.
- Novos módulos `lib/marketing/{ga4,youtube,tiktok}.ts` (fetch + normalizar → upsert diário).
- Guardar em `marketing_daily_insights` (ou tabela por fonte se as métricas divergirem muito).
- Somar ao `POST /api/marketing/sync` (e ao cron já existente).
- Cards no Dashboard de marketing + contexto no chat (`lib/ai/marketing-context.ts`).

### Ordem recomendada
1. **GA4** (reusa a SA, só precisa do Property ID + acesso). 2. **YouTube nível A** (API key + Channel ID).
3. **TikTok** e **YouTube nível B** (OAuth) conforme necessidade.
