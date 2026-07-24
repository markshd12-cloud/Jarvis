# TikTok — o que VOCÊ precisa fazer (app + OAuth)

Confirmado com o usuário (2026-07-21): **usam TikTok Ads** e têm presença nas **3 empresas**
(CPPEM, Colégio, Unicive). Então vale integrar — começando pelo **Ads** (mídia paga), que é
onde está o dinheiro, e depois o **orgânico**.

⚠️ Diferente do GA4/YouTube (onde bastou habilitar uma API e reusar a service account) e do
Instagram (que reusou o token da Meta), o TikTok **não tem credencial reaproveitável**: exige
app próprio + OAuth. E não dá para eu validar nada ao vivo antes de o app existir.

---

## ⚠️ Pegadinha nº 1: são DUAS plataformas de desenvolvedor diferentes

Muita gente se perde aqui. Confira em qual você está:

| Plataforma | Para quê | Onde |
|---|---|---|
| **TikTok for Business** | **Marketing API** — Ads (spend, cliques, conversões) | `business-api.tiktok.com/portal` |
| **TikTok for Developers** | Login Kit, Display API, conteúdo/orgânico | `developers.tiktok.com` |

Para o que interessa primeiro (**Ads**), é a **TikTok for Business**.

---

## Passo a passo — Ads (Marketing API)

1. **Ter o TikTok Ads Manager** com as contas de anunciante das 3 empresas (vocês já têm,
   já que rodam Ads).
2. Acessar `https://business-api.tiktok.com/portal` e criar uma **conta de desenvolvedor**.
3. **Criar um app** (Developer Application):
   - Nome: `Jarvis`
   - **Redirect URI / Advertiser redirect URL**:
     `http://162.243.194.122:3000/api/tiktok/callback`
     *(trocar pelo domínio final quando houver; adicionar também o de localhost se for testar em dev)*
   - Permissões/escopos: **Ads Management — leitura** (relatórios/insights). Não precisamos
     de escrita: só lemos.
4. Anotar **App ID** e **App Secret** (o Secret **não** deve ser colado em chat/commit —
   vai direto para o `.env`).
5. **Autorizar as contas de anunciante**: o fluxo OAuth abre uma tela onde o dono da conta
   escolhe **quais anunciantes** o app pode ler. Autorizar as **3 empresas**.
6. Ao final do OAuth obtemos o **access token** e a lista de **`advertiser_id`** — é isso que
   o Jarvis precisa.

### Sobre revisão/aprovação
O TikTok tem processo de revisão para apps. Para **ler as suas próprias contas** costuma
haver um modo sandbox/uso interno mais rápido, mas **o prazo depende deles** — é o gargalo
do projeto e roda no tempo do TikTok, não no nosso. Comece por aqui.

### Ponto positivo
Diferente do YouTube Nível B (onde o token pode expirar em 7 dias no modo Teste), o token da
Marketing API do TikTok é **longo** — autoriza uma vez e segue funcionando.

---

## Depois: orgânico (opcional, fase 2)
Conta e vídeos (seguidores, views, perfil, curtidas, comentários, compartilhamentos, tempo
médio assistido). Usa a outra plataforma (`developers.tiktok.com`) com Login Kit + escopos de
conta business. Encaixa nas MESMAS tabelas do Instagram/YouTube — sem migration nova.

---

## Como vai encaixar no Jarvis (plano técnico)

- `MarketingProvider` passa de `"meta_ads" | "ga4"` para incluir **`"tiktok_ads"`**.
- **`lib/marketing/tiktok.ts`**: sync dos insights diários por anunciante →
  **`marketing_daily_insights`** (`provider='tiktok_ads'`, `brand` = mesma etiqueta do Meta:
  "CPPEM Concursos", "Colégio", "Unicive"). Usar os mesmos rótulos faz o **filtro de marca e
  o CAC funcionarem cruzando Meta + TikTok** automaticamente.
- **Config**: `advertiser_id` de cada marca fica em `lib/marketing/config.ts` (mesmo padrão
  dos `adAccountId` do Meta); segredos no `.env`:
  `TIKTOK_APP_ID`, `TIKTOK_APP_SECRET`, `TIKTOK_ACCESS_TOKEN`.
- Entra no **`POST /api/marketing/sync`** (cron de 6/6h), isolado em try/catch próprio — uma
  falha do TikTok não derruba Meta/IG/YouTube.
- Aba **TikTok** do dock (hoje "em breve") passa a `ready: true` + componente de métricas.
- **Bônus:** ao entrar no `marketing_daily_insights`, o TikTok soma automaticamente no
  **CAC** (custo de mídia por marca) sem código extra.

---

## O que me mandar quando terminar
- [ ] **App ID** (pode mandar no chat) e aviso de que criou o **Secret** (esse vai no `.env`)
- [ ] Os **3 `advertiser_id`** (CPPEM, Colégio, Unicive)
- [ ] Confirmação de que o OAuth foi autorizado para as 3 contas
- [ ] Se quer também o **orgânico** ou só Ads por enquanto
