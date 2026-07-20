# Jarvis — Diagnóstico RAG + Sync do Notion (sessão 2026-07-20)

Investigação de "o Jarvis não usa dados que existem". Foram **três problemas
distintos**, todos comprovados com dados de produção. Este doc registra causa
raiz, evidência e planos de ação para retomar após o compact.

## Estado do working tree ao pausar
- `app/api/chat/route.ts` — **modificado (não commitado)**: ajuste de prompt de
  reconciliação memória×Notion (item 1 abaixo). O log de debug temporário JÁ FOI
  removido.
- Dev server `next dev` rodando na porta **3000** (`.next` foi limpo nesta sessão).
- Empresa da sessão de teste (superadmin `administrador@cppem.com.br`):
  `companyId = faf1f039-2976-477b-885a-0b0d947e91be`.

---

## Problema 1 — Prompt: memória rebaixada a "dica" (RESOLVIDO no código, a decidir commit)

**Sintoma:** perguntas cuja resposta está numa memória destilada eram respondidas
com "não tenho o dado", porque o system prompt rotulava documentos do Notion como
"verdade" e memórias como "dicas, podem estar incompletas".

**O que foi feito** (em `app/api/chat/route.ts`, ainda não commitado):
- `BASE_SYSTEM`: substituída a linha que rebaixava memória por uma **política de
  reconciliação de 3 casos** (pedida pelo usuário):
  1. memória concorda com a fonte → responde normal;
  2. memória preenche lacuna (fonte não cobre) → usa a memória, não diz que não sabe;
  3. memória diverge da fonte → responde primeiro o Notion e adiciona
     "Obs.: na memória interna há divergência — <o que a memória diz>".
- Rótulo do bloco: "Memórias internas (dicas, podem estar incompletas)" →
  "Memórias internas (fatos aprendidos em conversas com o usuário)".

**Validação:** testado isolado no **Gemini** (gemini-2.5-flash) → os 2 casos
(lacuna e divergência) passaram. MAS o app usa **Claude** (`JARVIS_DEFAULT_PROVIDER=claude`),
e o caso real (Ladjane) era o Problema 2 (tenancy), não reconciliação — então
este ajuste é **ortogonal** e não foi validado no caminho Claude com contexto real.
Typecheck OK.

**Ação pendente:** decidir **commitar / manter sem commitar / reverter**.
Recomendação: manter (é melhoria legítima e de baixo risco), commitar isolado.

---

## Problema 2 — Ladjane: fragmentação de tenant (EM ABERTO, decisão do usuário)

**Sintoma:** "Quem é a Coord. Pedagógica do Colégio?" não retorna "Ladjane Maria",
mesmo a memória existindo.

**Causa raiz (comprovada):** o conhecimento do colégio está **espalhado em 2
empresas (tenants)**:
- `faf1f039` (empresa do superadmin logado) — tem memórias genéricas do colégio,
  mas **NÃO** o fato da Ladjane.
- `8c103ccd` — tem a memória `"A coordenadora pedagógica é Ladjane Maria"` (conf 0.9).

O RAG (`match_memories`, `hybrid_search_documents`) roda sob RLS preso a
`current_company_id()` = `profiles.company_id` do usuário = `faf1f039`. As policies
de `memories`/`documents` **NÃO têm bypass de superadmin** (só `companies` e
`profiles` ganharam `is_superadmin()` na migration `0013_roles.sql`). Logo a
memória da Ladjane (tenant `8c103ccd`) é inalcançável nessa sessão.
Comprovado por log de debug: `companyId=faf1f039, hasLadjane=false`.
(Nota: `match_memories` rankeia a Ladjane em #2, sim 0.7285 — QUANDO consultada
DENTRO do tenant `8c103ccd`. O problema é 100% escopo de empresa.)

**Opções de ação:**
1. **Consolidar tenants** (recomendado se o colégio deve ser um só) — migrar
   memórias/documentos de `8c103ccd` → `faf1f039` (ou definir qual é o oficial).
   Requer decisão de qual tenant é o "oficial" do colégio.
2. **Superadmin com "empresa ativa" trocável** — adicionar seletor que muda o
   escopo do RAG (hoje `current_company_id()` é fixo no perfil). Mudança de
   arquitetura (afeta RLS/contexto).
3. **Bypass de RAG p/ superadmin** — NÃO recomendado (mistura empresas, vaza dado
   cross-tenant).

**Decisão pendente do usuário:** qual opção, e (se 1) qual tenant é o oficial.

---

## Problema 3 — Atividades Diárias do Mark: sync do Notion travado (CAUSA RAIZ ACHADA)

**Sintoma:** "relatório do dia 17/07 de Mark" → Jarvis acha só até ~29/06 e diz
que não tem o resto.

**Fatos comprovados:**
- Os relatórios são linhas da database Notion **"Atividades Diárias Realizadas"**
  (`collection://f61d7455-55b9-4c30-88ad-97da5573348f`; URL do usuário:
  `notion.so/.../38a291980b244978931e14150a40942d`). O texto do relatório fica na
  propriedade **rich_text "Escreva seu relatório das atividades de hoje"** — que o
  sync SABE ler (`propertiesText` trata rich_text). Ou seja, NÃO é o
  `buildPageText` de linha-de-banco (esse funciona).
- No Notion existem entradas do Mark em 16/07, 15/07, 14/07, 13/07, 10, 9, 8, 7,
  3, 2, 1/07... **Não existe 17/07** (o último é 16/07 — a data pedida não tem
  registro; o Mark é do setor Tecnologia).
- No Supabase (`documents`, empresa `faf1f039`), o último "Mark" com data é
  **01/07/2026**. Tudo de **02/07 a 16/07 existe no Notion e NÃO está indexado**.
- `notion_connections`: `last_edited_watermark = 2026-07-02T19:12:00Z` (CONGELADO),
  `last_synced_at = 2026-07-20` (sync roda), `sync_cursor = null`.

**Causa raiz:** o **sync incremental está travado**. Em `lib/notion/sync.ts`:
- `runIncremental` só avança o watermark quando a rodada **termina inteira**
  (`const done = !timedOut; if (done && newest) update.last_edited_watermark = newest`).
- Se estoura `SYNC_BUDGET_MS` (90s), `done=false` → watermark **não avança**.
- O incremental **não tem cursor de retomada** (só o `runBackfill` tem, via
  `sync_cursor`). Então toda rodada **recomeça do topo**, reprocessa os primeiros
  data sources e **nunca chega** (ou erra) na database "Atividades Diárias" — que
  fica faminta (starvation). Resultado: nada editado após 02/07 entra no índice.

**Planos de ação:**

- **3A. Recuperar os dados AGORA (operacional, escreve em produção):** resetar
  `last_edited_watermark = null` e `sync_cursor = null` em `notion_connections`
  para a empresa `faf1f039` → força `runBackfill`, que É resumível (salva cursor
  entre rodadas) e reindexa tudo que falta. Idempotente (upsert por `external_id`,
  pula inalterados por `content_hash`). Disparar o loop de sync depois (via UI ou
  chamando `syncNotion`).
  - SQL: `update public.notion_connections set last_edited_watermark = null,
    sync_cursor = null where company_id = 'faf1f039-2976-477b-885a-0b0d947e91be';`
  - **Requer OK do usuário** (produção).

- **3B. Corrigir a causa (código, `lib/notion/sync.ts`):** dar ao `runIncremental`
  um **cursor de retomada** (como o backfill) — ao estourar o tempo, salvar em
  `sync_cursor` a posição (dsQueue restante + dsCursor + pendingWatermark), pra
  próxima rodada continuar de onde parou em vez de recomeçar. Alternativa/reforço:
  ao detectar starvation, avançar o watermark só até o ponto totalmente coberto.
  Isso evita a recorrência do buraco.

- **3C. (menor) `searchDocumentsByDate` filtra nome pelo TÍTULO.** Para as linhas
  de "Atividades Diárias" o título é o Nome ("Mark"), então funciona. Mas para
  notas onde a pessoa aparece só no corpo/propriedade (ex.: "Reunião - Daily Tech",
  Participantes: Mark), o filtro por título exclui. Reavaliar se o filtro de nome
  deveria olhar também o conteúdo/participantes. Baixa prioridade.

---

## Ordem sugerida de retomada
1. Confirmar decisão do Problema 1 (commit do ajuste de prompt).
2. Problema 3A (recuperar dados do Mark) — impacto imediato, com OK do usuário.
3. Problema 3B (hardening do incremental) — evita recorrência.
4. Problema 2 (tenancy) — decisão de produto do usuário.
