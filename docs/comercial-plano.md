# Módulo Comercial — Copiloto de Vendas (plano completo)

Área **Comercial** dentro do Jarvis: um **copiloto do vendedor** (extensão Chrome que lê
o chat ao vivo e sugere estágio/resposta/objeção) + um **centro de dados comercial**
(dashboard de performance por vendedor, funil, gargalos, onde a venda é perdida).

Uso **interno** (CPPEM). Base: o projeto próprio **`c:\Projetos\morubi`** (não deployado) —
**reaproveitado**, não reescrito do zero. Escrito em 2026-07-30.

---

## 1. Objetivo de negócio
- **Copiloto em tempo real** para o vendedor durante o atendimento (WhatsApp Web / Kentro /
  AtenderBem / Z-Pro `atendimento.cppem.com.br`).
- **Inteligência de vendas** para a gestão: quais vendedores performam melhor/pior, **onde o
  funil trava (gargalo)**, **por que perdemos** (objeções não contornadas, erros recorrentes),
  coaching automático.

## 2. Decisões de arquitetura (validadas)
- **Dados: PostgREST direto** (padrão do Jarvis) — **não** Prisma. Reescrevemos só a *camada
  de acesso a dados*; reusamos a *lógica*.
- **Reusar do Jarvis (não reconstruir):** multiempresa (`company` = "tenant"), `profiles` +
  **RBAC** (vendedor/gestor), **auth Supabase**. → cortamos `Tenant`/`User`/`Invite`/`Role` do morubi.
- **Reusar do morubi:** (a) **extensão** (adaptadores de DOM — o maior valor), (b) **lógica de
  IA** (RAG, análise estruturada, coaching, embeddings/transcrição Gemini, prompts), (c)
  **contratos Zod** (fronteira HTTP extensão↔API).
- **Reescrever:** acesso a dados (Prisma → Supabase admin client + RPC pgvector), Route
  Handlers no estilo Jarvis, dashboard como páginas Jarvis.

## 3. Modelo de dados (migrations Supabase, prefixo `com_`)
Todas escopadas por `company_id`, **RLS habilitada sem policies** (só service_role), como as `fin_*`.

| Tabela | O que guarda | Campos-chave |
|---|---|---|
| `com_conversas` | o lead/negócio | `channel`, `external_key`, `lead_name`, `outcome` (em_aberto/ganha/perdida), `deal_value`, `vendedor_id`(→profile), `company_id`. **unique(vendedor_id, channel, external_key)** |
| `com_mensagens` | mensagens da conversa | `conversa_id`, `sender`(cliente/vendedor), `type`(texto/audio), `content`, `external_id`, `timestamp`. **unique(conversa_id, external_id)** (dedupe) |
| `com_sugestoes` | saída da IA por análise | `stage`, `probability`, `next_action`, `objection`, `objection_reply`, `mistakes[]`, `useful_feedback` |
| `com_memoria_contato` | memória evolutiva **por contato** | `company_id`, `channel`, `external_key`, `summary`, `key_facts[]`, `analysis_count`. **unique(company_id, channel, external_key)** |
| `com_correcoes` | aprendizado | `scope`(vendedor/empresa), `original`, `corrected`, `vendedor_id`, `approved_by` |
| `com_conhecimento` | base RAG | `title`, `content`, **`embedding vector(1536)`** (via migration SQL) |
| `com_coaching` | relatório por vendedor/período | `vendedor_id`, `vendedor_nome`, `period`, `content`(markdown), `source` |
| `com_copilot_chat` | chat livre vendedor↔Jarvis | `role`, `content`, `correction_id?` |

**pgvector:** habilitar extensão `vector` + função SQL `com_match_conhecimento(company, embedding, k)`
(distância de cosseno) + função de update do embedding (PostgREST não faz cast `::vector` em PATCH).

## 4. Funções / módulos (o que construir)
**Backend (dentro do Jarvis):**
- `lib/comercial/ai/*` — portado de `packages/ai`: `analyze`, `rag`, `chat`, `coaching`,
  `insight`, `embeddings` (Gemini `gemini-embedding-001`, 1536), `transcribe` (Gemini
  multimodal), `prompts`, `sanitize`. Provider: Claude via Vercel AI SDK.
- `lib/comercial/data.ts` — **acesso PostgREST** (substitui `@morubi/db`): buscar mensagens,
  correções (`or=`), memória (chave composta), `com_match_conhecimento` via `rpc()`.
- `lib/comercial/contracts.ts` — Zod (portado de `api-client`) **com as melhorias** (§6).
- Rotas `app/api/comercial/*`: `conversas` (upsert), `conversas/[id]/messages`,
  `.../analyze`, `.../chat`, `.../outcome`, `transcribe`, `metrics`, `conhecimento` (CRUD+upload),
  `coaching` (+ generate/schedule/cron). Padrão Jarvis: `finContext`-like gate + Zod + admin client.
  CORS liberado (auth por Bearer, não cookie) para a extensão.
**Dashboard:**
- `app/(app)/comercial/*` + `components/comercial/*` — aba "Comercial" no sidebar (nova feature
  em `lib/permissions.ts` → vira checkbox na matriz de RBAC).
**Extensão (projeto separado, WXT):**
- Rebrand do `apps/extension`: rebrandear "Jarvis", apontar `WXT_API_BASE_URL` para `/api/comercial`
  do Jarvis, reusar o cliente Supabase (Bearer). Manter os adaptadores (WhatsApp/Kentro/Z-Pro).

## 5. Dashboard — análise de performance (o coração do pedido)
Derivado das tabelas acima (vendedor = `profile`):
- **Ranking de vendedores** — win rate, receita fechada, ticket médio, nº de conversas, tendência.
- **Funil / gargalo** — conversão entre estágios → onde os negócios travam (ex.: "chega em
  Proposta mas não fecha").
- **Onde perdemos** — `outcome=perdida` × `objection` × `mistakes[]` → objeções não contornadas
  e erros mais comuns, por vendedor.
- **Pipeline** — leads quentes (`probability ≥ 70`), vendas em risco, receita projetada
  (ponderada por probabilidade).
- **Coaching automático** — relatório estilo coordenador por vendedor/período.

## 6. Melhorias validadas (aplicar no port) — da revisão dos 3 pilares
**IA:**
- Delimitar a fala do cliente no prompt (`<mensagem_cliente>`) — anti **prompt injection** (que
  hoje contamina a **memória persistida**).
- **Escopo por empresa + RLS** em toda query (o Jarvis já é multiempresa).
- **Chunking** na base de conhecimento (hoje corta em 8000 chars → doc grande some do RAG).
- `maxTokens` explícito + tratar `NoObjectGenerated` (o `claude-sonnet-5` liga *thinking* por
  padrão → risco de truncar) com 1 retry.
- Piso de similaridade no RAG; `cache_control` no system prompt (custo).
**Extensão:**
- **Telemetria de quebra de adaptador** (hoje `captureError` é código morto → falha em silêncio).
- **Revalidar os seletores do WhatsApp Web** (`data-testid` provavelmente já quebrados) + fallback.
- **`external_key` por telefone/`data-id`**, não pelo nome do chat (senão leads homônimos se misturam).
- Domínio da API do Jarvis em `host_permissions`; remover `*.vercel.app`/localhost do prod.
- **Throttle da análise** (só após N s de silêncio) — custo de LLM; tratar 401/refresh.
**Contratos:**
- **Timeout** no cliente HTTP (`AbortSignal.timeout`).
- **Enums tolerantes na resposta** (`.catch`) — a extensão publicada não pode quebrar quando a
  API evoluir; estritos no request.
- `.max()` em `content`/`recentMessages`/correções (payloads).
- Padronizar erro como `ApiError`; camada **snake_case→camelCase** nas Route Handlers.

## 7. Plano de ação faseado
- **Fase 0 — Fundação:** migrations `com_*` + pgvector + funções SQL; feature `comercial` no RBAC.
- **Fase 1 — Backend do copiloto:** portar IA + `data.ts` (PostgREST) + rotas `analyze/messages/
  conversas/transcribe/chat/outcome`. Testar com dados semeados.
- **Fase 2 — Extensão Jarvis:** rebrand + apontar API + auth + telemetria + revalidar seletores.
  Distribuir **interno** (Workspace admin / unpacked no piloto).
- **Fase 3 — Dashboard Comercial:** pipeline + **performance por vendedor / gargalo / motivos de perda**.
- **Fase 4 — Coaching & insights** + contexto no chat do Jarvis.

## 8. Dificuldades / riscos (honestos)
- **WhatsApp Web via DOM** fere o ToS e **quebra** quando o layout muda → **telemetria de quebra
  é obrigatória**. Seletores atuais podem já estar desatualizados.
- **LGPD:** vamos **ler e armazenar conversas de clientes** — precisa de base legal/consentimento,
  minimização e retenção definida.
- **Custo de LLM:** cada análise é uma chamada ao Claude → controlar com throttle + cache.
- **Prisma → PostgREST:** o pgvector exige RPC (o cast `::vector` não vai em PATCH normal).
- **Extensão ≠ API (versões desencontradas):** distribuída à parte → enums tolerantes evitam
  quebrar clientes antigos.
- **Escala:** é um **módulo/produto** (semanas), do porte do módulo de Marketing.

## 9. Prós × Contras
**Prós:** reaproveita ~90% (extensão + IA + contratos); o Jarvis já resolve auth/multiempresa/RBAC;
entrega inteligência de vendas acionável (vendedor, funil, perda); copiloto já provado no morubi.
**Contras:** escopo grande; fragilidade e ToS do WhatsApp; responsabilidade LGPD; custo de LLM;
manutenção contínua dos adaptadores; extensão exige ciclo de publicação/atualização à parte.

## 10. Distribuição da extensão (interno)
- **Piloto:** carregar "descompactada" (unpacked) — grátis, sem revisão.
- **Definitivo interno:** **Google Workspace → Admin console → forçar instalação** (extensão
  gerenciada) — sem revisão do Google. (Alternativa: Web Store "não listada", taxa **única** de US$5.)

## 11. Copiloto (chat "Falar com o Jarvis") — melhorias
Base do morubi: o chat livre vendedor↔copiloto já responde ancorado na base de conhecimento
(RAG) e **detecta correções** ("não é assim…") → grava como aprendizado e reanalisa. O "algo a
mais" abaixo nasce de uma vantagem que o morubi não tinha: **o chat conectado ao resto do Jarvis**.
Os 6 pontos, priorizados por valor, com esforço e ressalvas:

| # | Melhoria | O que é | Esforço | Prós | Contras / risco |
|---|---|---|---|---|---|
| **1** ⭐ | **Contexto do cliente (Conta Azul)** | O copiloto sabe quem é o contato cruzando com o financeiro que já temos (aba Clientes): "já é aluno, 2 compras, LTV R$ 3,2 mil, adimplente" ou "tem parcela vencida" | Médio | Diferencial forte p/ venda e retenção; reusa dado existente | Casar contato do WhatsApp × cliente do CA (por telefone/nome) tem ambiguidade |
| **2** ⭐ | **Ações reais (tool-calling)** | O chat *faz*, não só responde: "marcar como ganha/perdida", "agendar follow-up", "salvar na memória do contato", "gerar proposta" | Médio | Vira assistente que executa, não só aconselha | Cada ação é uma integração; começar com 2-3 |
| **3** ⭐ | **Resposta pronta p/ colar** | Botão **"copiar"** a resposta sugerida (ou colar no campo do WhatsApp sem enviar) | Baixo | Ganho de UX imediato | ⚠️ **Auto-ENVIAR** cruza de "ler" (área cinza) para "automatizar" o WhatsApp → **risco sério de ToS/ban**. **Parar no "copiar"/colar-sem-enviar.** |
| **4** | **Proatividade (alertas)** | O copiloto avisa sem ser perguntado: "lead esfriou há 3 dias — follow-up", "sinal de compra — peça o fechamento" | Médio | Vira coach ativo | Precisa de regras p/ não virar spam |
| **5** | **Modo treino / roleplay** | "Me treina p/ contornar objeção de preço" — o Jarvis simula o cliente difícil e dá feedback | Baixo | Ataca justamente os vendedores fracos que o dashboard aponta; barato (é um modo de prompt) | — |
| **6** | **Base compartilhada com o Jarvis** | O chat puxa também o conhecimento do assistente principal (Notion, docs) além da base comercial — política de desconto, prazos, etc. | Baixo | Reusa o RAG que já existe | Escopo de permissão (o que o vendedor pode ver) |

**Ordem recomendada:** MVP com **1 + 2 + 3** (o copiloto que *conhece o cliente*, *executa ações*
e entrega a *resposta pronta pra colar* — sem auto-envio); **5** como bônus barato de treino; **4**
e **6** na sequência. **Regra dura:** nunca **enviar** mensagem automaticamente no WhatsApp — só
sugerir/copiar — para não expor as contas a ban por violação de ToS.
