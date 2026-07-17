# PRD — Sistema Financeiro Gerencial (multi-BU) · CPPEM

**Status:** em implementação — Passos 1–3 concluídos (ver §0) · **Data:** 2026-07-16
**Rota:** `/financeiro` · **Acesso:** permissão `financeiro` (admin) · **Stack:** Next 16 (Turbopack) + Supabase (Postgres) + Conta Azul API v2

---

## 0. Status de implementação (atualizado 2026-07-16)

### Concluído
- **Passo 1 · Migration `0023_financeiro`** ✅ — 12 tabelas do §5 + função/trigger
  `fin_set_updated_at`; RLS ligada e **service-role-only** (sem policy/grant, padrão
  `contaazul_connections`); `numeric(14,2)`, enums text+check, `on delete restrict` nas
  dimensões, uniques de idempotência. Aplicada no Supabase.
- **Passo 2 · Seed + de-para BU** ✅ — `lib/financeiro/seed.ts` + `GET/POST
  /api/financeiro/seed` (idempotente, **validado ao vivo, 2 rodadas idênticas**): **4 BUs**
  (CPPEM/Colégio/Unicive/**Geral**), 10 centros, 117 categorias, DRE 100% mapeado
  (`semGrupo:[]`), **0 receita sem BU** (11 corporativas/financeiras caíram em "Geral",
  reatribuíveis). Sonda de shape `seed/preview` (descartável). **Decisão travada:** a
  hierarquia da UI é **grupo_dre (01…08) + codigo**, não o `categoria_pai` do CA (o
  `/categorias` só devolve as folhas → `parent_id` fica inerte). `natureza` o CA não tem → null.
- **Passo 3 · Camada de acesso `lib/financeiro/*`** ✅ (`tsc` verde) — `types.ts`,
  `context.ts` (`finContext()` = gate `financeiro` + `companyId` num lugar só), `bus.ts`,
  `centros.ts`, `categorias.ts` (list/create/update/setAtivo + `getCategoriaTree` por grupo;
  **inativa nunca exclui**; Zod na entrada; escopado por `companyId`). Validação **E2E fica
  para o Passo 4** (quando rotas/UI consumirem). `colaboradores/despesas/orcamentos` entram
  nos passos 5/6/9.

### ⚠️ Estado real da UI `/financeiro` — só a aba DRE existe
O `app/(app)/financeiro/financeiro-shell.tsx` renderiza um **FloatingDock com 6 abas**, mas
**apenas a DRE está ligada** (`ready:true` e única que renderiza conteúdo). As outras **5 são
placeholders "(em breve)" que NÃO navegam** — clicar não faz nada (`if (tab.ready) setActive`).
Ou seja, os botões de Fluxo de Caixa, % Centro de Custo, Contas a Pagar, Vendas e Faturar e
**Cadastros** ainda **não têm tela**. Cada um só vira `ready:true` + ganha seção no seu passo:

| Aba no dock hoje | Ligada em | Situação |
|---|---|---|
| DRE | Fase 1 | ✅ funcional |
| Categorias & Centros (Cadastros) | **Passo 4** | ⏭️ próximo |
| Contas a Pagar | Passo 6 | pendente (placeholder no dock) |
| % Centro de Custo | Passo 14 | pendente (placeholder no dock) |
| Fluxo de Caixa | Passo 13 | pendente (placeholder no dock) |
| Vendas e Faturar | Passo 15 | pendente (placeholder no dock) |
| _(a adicionar)_ Colaboradores & Fornecedores | Passo 5 | ainda **não está no dock** |

> **Regra de UX:** não deixar botão "morto". Ao concluir cada passo, marcar `ready:true` no
> `TABS` do shell e renderizar a seção; a aba de Colaboradores precisa ser **acrescentada** ao
> `TABS` no Passo 5.

### Roadmap restante
Passos 4–17 do §9 continuam válidos. Largada corrigida (o **3 não é opcional** — é dependência
de 4/5): **1 ✅ → 2 ✅ → 3 ✅ → 4 → 5 → 6 → …**. Mais sensíveis à frente: **Passos 6/7**
(Contas a Pagar + parcelamento/edição em massa) e **Passo 11** (DRE v2 + cutover, risco de
double-count).

---

## 1. Visão & objetivo

Construir um sistema gerencial de custos **próprio**, para fazer a gestão financeira da
CPPEM sem depender dos relatórios do Conta Azul (que "não se conversam" e não filtram pela
nossa realidade). O sistema segue as **premissas de mercado** de financeiro (DRE, Fluxo de
Caixa, Orçado × Previsto × Realizado, centros de custo, rateio) e adiciona a dimensão que o
CA não tem: **BU** (unidade/empresa interna: **CPPEM, Colégio, Unicive**).

O Conta Azul deixa de ser a ferramenta de gestão e vira **âncora de duas coisas apenas:
receita (contas a receber / vendas) e emissão de notas fiscais**. Todo o resto — despesas,
orçamento, parcelamento, relatórios — passa a viver no nosso banco.

### Definição de sucesso
- Todo relatório (DRE, Caixa, % por centro) **filtra por BU** e por período.
- Despesas são lançadas in-house, com **previsto × realizado**, **limite/alerta** e
  **parcelamento** (cada parcela podendo ser paga por uma BU diferente).
- Os números **batem** com a contabilidade (reconciliáveis contra o CA na receita).
- Só **administradores** enxergam — é a "foto" de como a empresa está por dentro.

---

## 2. Escopo

### No escopo (10 abas)
1. Dashboards TV · 2. DRE · 3. Fluxo de Caixa · 4. % por Centro de Custo ·
5. Contas a Pagar · 6. Vendas & contas a faturar · 7. Cadastros (Categorias / Centros /
BU) · 8. Colaboradores & Fornecedores · 9. Clientes · 10. Produtos & Serviços.

### Fora do escopo (explícito)
- Emissão de nota fiscal (fica no CA).
- Substituir ERP fiscal/contábil. Escopo = **gestão de custos + previsão**, não fiscal.
- Conciliação bancária automática (open finance) — pode virar fase futura.

### Contras assumidos (do próprio racional)
- **Alguém lança receita/despesa diariamente.** O design deve minimizar atrito: edição em
  massa, recorrência, duplicação de lançamento, defaults, import.
- Não é ERP de verdade — o valor está no **controle gerencial e na previsão**, não na parte fiscal.

---

## 3. Premissas & decisões travadas

- **BU ≠ tenant.** `company_id` = a conta da CPPEM no Jarvis (multi-tenant do produto).
  **BU** = unidade interna (CPPEM / Colégio / Unicive), uma dimensão nossa, nova, que o CA
  não carrega. Toda tabela é escopada por `company_id`; a análise é por `bu_id`.
- **BU não existe no CA.** A unidade está no **nome das categorias** (`1.8 MENSALIDADE
  COLÉGIO` → Colégio, `1.5 MATRÍCULA UNICIVE` → Unicive). Logo a BU da **receita** é
  resolvida por um **de-para categoria → BU**. A BU da **despesa** é escolhida no
  lançamento, **por parcela**.
- **Fonte de verdade por tipo** (regra de ouro — cada dado tem UM dono):

  | Dado | Dono | Uso nosso |
  |---|---|---|
  | Receita (a receber, vendas, NF) | **Conta Azul** (read) | Snapshot nosso; nunca editamos |
  | Despesa (contas a pagar) | **Nosso banco** (write) | Lançada in-house |
  | Categorias / estrutura DRE | Nosso (seed do CA) | Importa 1×, depois é nosso |
  | Centros de custo | Nosso (seed do CA) | idem |
  | **BU** | **Só nosso** | Dimensão nova |
  | Colaboradores / Fornecedores | Nosso | Atrela despesa de pessoal |
  | Clientes | Conta Azul | Read/sync |

- **Snapshot da receita, não read-live.** A API do CA é eventualmente consistente (atrasa
  horas) e o token cai no deploy (ver `docs/financas-modulo.md` §Atraso da API e a corrida
  de refresh_token). Um snapshot com carimbo `sincronizado_em` deixa o relatório rápido,
  estável, e sobrevive à queda do CA. O CA continua **dono**; o snapshot é cache.
- **Cutover de despesa por competência.** A partir de uma competência de corte (ex.
  `2026-08`), despesa = 100% nossa. Antes disso, o DRE lê despesa do CA (como hoje). Campo
  `fonte` + data de corte evitam double-count. Histórico anterior é import opcional.
- **DRE = por competência, realizado** (hoje). Fase 4 adiciona **previsto × realizado**.
- **Segurança de 1ª classe.** RLS no Postgres, tudo gateado por `financeiro`, auditoria de
  quem lançou/editou. É a foto interna da empresa.

---

## 4. Arquitetura de dados

```
Conta Azul (API v2) ──sync──►  fin_receita_snapshot   ─┐
                                                        ├─►  Relatórios (DRE, Caixa, %CC)
Lançamento in-house ─────────►  fin_despesas/parcelas ─┘        filtrados por BU × período
                                                               (merge das duas fontes)
Cadastros (seed CA) ─────────►  business_units · fin_categorias · fin_centros_custo
Metas gerenciais ────────────►  fin_orcamentos ──trigger──► fin_alertas ──► Dashboards TV
```

Camadas de código (padrão do projeto):
- `lib/financeiro/` — queries tipadas + validação Zod (server-only), uma por agregado.
- `app/api/financeiro/*` — rotas gateadas por `can(ctx,"financeiro")`.
- `app/(app)/financeiro/*` + `components/financeiro/*` — UI (abas via FloatingDock, já existe).
- `supabase/migrations/0023_financeiro.sql` — schema + RLS + seed helpers.

---

## 5. Modelo de dados completo

Convenções: toda tabela tem `id uuid`, `company_id uuid`, `created_at`, `updated_at`,
`created_by`/`updated_by` (auditoria). RLS: acesso só via service_role + checagem
`financeiro`. Prefixo `fin_`.

### 5.1 Dimensões

**`business_units`** — a BU (unidade/empresa interna)
```
nome · slug · cnpj(null) · cor(hex, p/ charts) · ativo · ordem
```

**`fin_categorias`** — hierárquica (pai / filho / neto) + estrutura DRE
```
parent_id (self-ref, null=raiz)      ← 3 níveis: pai/filho/neto
codigo('1.8','03.2')  · nome
tipo('receita'|'deducao'|'custo'|'despesa'|'imposto'|'financeira')
grupo_dre('01'..'08')                 ← casa com as linhas do DRE atual
natureza('fixa'|'variavel')           ← gráfico fixas×variáveis
bu_id(null)                           ← RECEITA: resolve a BU (de-para)
ca_categoria_id(null)                 ← de-para com o CA (dedup no snapshot)
ativo · ordem
```

**`fin_centros_custo`**
```
codigo · nome · ca_centro_id(null) · ativo
```

**`fin_colaboradores`** — colaboradores & fornecedores (pessoas internas)
```
nome · cpf_cnpj · tipo('colaborador'|'fornecedor')
banco(null) · agencia(null) · conta(null) · chave_pix(null)
cargo(null) · salario_base(null) · bu_id(null) · ca_pessoa_id(null) · ativo
```

### 5.2 Lançamentos

**`fin_despesas`** — cabeçalho da conta a pagar (o "contrato")
```
descricao(nome) · observacao(descrição longa)
categoria_id → fin_categorias · centro_custo_id(null) · colaborador_id(null)
valor_total  numeric            ← soma das parcelas (denormalizado p/ conferência)
num_parcelas int (default 1)
recorrencia_id(null) → fin_recorrencias
fonte('manual'|'ca_import') · ca_evento_id(null, dedup) · cancelada(bool)
```

**`fin_parcelas`** — cada parcela é a **unidade de rateio, BU e pagamento**
```
despesa_id → fin_despesas · numero(1..N)  UNIQUE(despesa_id,numero)
bu_id → business_units          ← QUAL empresa paga ESTA parcela
valor_previsto  numeric          ← estimativa da parcela
valor_realizado numeric(null)    ← preenchido na baixa (pagamento)
data_competencia date            ← regime de competência (DRE)
data_vencimento  date
data_pagamento   date(null=não paga)
status('prevista'|'a_pagar'|'paga'|'atrasada'|'cancelada')
metodo_pagamento('pix'|'boleto'|'cartao'|'dinheiro'|'guru'|'stone'|...)
```
> **Por que a parcela carrega BU e não a despesa:** o requisito "qual empresa paga cada
> parcela" exige BU por parcela. Uma despesa à vista é só uma despesa com **1 parcela**.
> Editar parcelamento = CRUD em `fin_parcelas` (mudar nº de parcelas, valores, BU,
> vencimento) mantendo `valor_total = Σ parcelas`.

**`fin_despesa_rateio`** *(opcional — rateio de UMA parcela entre várias BUs)*
```
parcela_id → fin_parcelas · bu_id · percentual   (Σ = 100%)
```
> Comece com `bu_id` na parcela (1 BU por parcela). Ligue o rateio só quando aparecer a 1ª
> parcela genuinamente compartilhada (ex. Aluguel dividido 50/50). Se há rateio, ele manda;
> senão, o `bu_id` da parcela.

**`fin_recorrencias`** — gera parcelas mensais (aluguel, salário…)
```
descricao · categoria_id · bu_id · colaborador_id(null)
valor_previsto · dia_vencimento · periodicidade('mensal'|'anual') · ativo
```

**`fin_receita_snapshot`** — espelho da receita do CA (BU já resolvida)
```
ca_evento_id UNIQUE · categoria_id · bu_id
valor · data_competencia · data_vencimento · data_pagamento(null)
recebido(bool) · sincronizado_em
```

### 5.3 Orçamento / Limite / Alertas

**`fin_orcamentos`** — meta AGREGADA (top-down) + teto de alerta
```
categoria_id · bu_id(null=todas) · competencia('AAAA-MM')
valor_orcado  numeric            ← a meta do período (previsto top-down)
valor_limite  numeric            ← teto que dispara alerta
ativo
UNIQUE(company_id, categoria_id, bu_id, competencia)
```

**`fin_alertas`** — materializa estouro pro card do painel
```
tipo('previsto_excede'|'limite_estourado')
categoria_id · bu_id · competencia
valor_referencia · valor_limite
status('aberto'|'visto'|'resolvido') · criado_em
```

### 5.4 Auditoria

**`fin_audit_log`** *(quem lançou/editou/pagou — a foto interna exige rastro)*
```
entidade('despesa'|'parcela'|'orcamento'|'categoria'|...) · entidade_id
acao('criar'|'editar'|'excluir'|'pagar'|'editar_massa') · diff(jsonb)
user_id · criado_em
```

---

## 6. Modelo Orçado × Previsto × Realizado × Limite

**4 conceitos, dono claro** — a premissa de mercado que o PRD exige. Chave de agregação de
tudo: **categoria × BU × competência**.

| Termo | O que é | Onde mora |
|---|---|---|
| **Orçado** | Meta que você define (top-down) | `fin_orcamentos.valor_orcado` |
| **Previsto** | Soma do que já foi lançado (bottom-up), pago ou não | `fin_parcelas.valor_previsto` |
| **Realizado** | O que de fato saiu (pago) | `fin_parcelas.valor_realizado` |
| **Limite** | Teto que dispara alerta | `fin_orcamentos.valor_limite` |

```
Realizado(cat,bu,comp) = Σ fin_parcelas.valor_realizado  WHERE status='paga'
Previsto(cat,bu,comp)  = Σ fin_parcelas.valor_previsto    (todas as lançadas)
Orçado / Limite        = fin_orcamentos (linha do período)
```

**Dois gatilhos de alerta** (ambos gravam `fin_alertas`, via trigger no insert/update de
`fin_parcelas` ou job por competência):
- **Pré-alerta** `previsto_excede` → **Previsto > Orçado**: "pelo que já lancei, vou furar".
- **Estouro** `limite_estourado` → **Realizado > Limite**: já saiu além do teto.

As 3 análises gerenciais que saem disso:
- **Orçado × Realizado** = aderência ao planejamento.
- **Previsto × Realizado** = o que a aba 4 (% por centro) filtra.
- **Previsto × Orçado** = o pré-alerta.

O "orçamento de marketing por BU" = `fin_orcamentos WHERE categoria IN (marketing) GROUP BY bu`.

---

## 7. Especificação por aba

### 1 · Dashboards TV
- **Card de alertas** = `fin_alertas WHERE status='aberto'`; cada item linka pro Contas a
  Pagar já filtrado (categoria×BU×competência) — "buscar pra ver o que aconteceu".
- **Gráfico anual (linha)** receita (verde) × despesa (vermelha), **mesclando entre BUs**
  (seletor CPPEM/Colégio/Unicive/consolidado).
- **Gráfico fixas × variáveis** (usa `fin_categorias.natureza`), por BU.

### 2 · DRE  *(existe — evoluir)*
- Tabela por competência (01…08 + subtotais + AV%). **Adicionar filtro BU** e **previsto ×
  realizado**. Migrar a fonte de despesa: CA → `fin_parcelas` no cutover.

### 3 · Fluxo de Caixa
- Filtros: **mensal** (ano) / **diário** (mês), BU, **realizado + previsto** (ou só um).
- Export/print. Meta explícita: **mais simples de ler** que o do CA.

### 4 · % por Centro de Custo
- Tabela centro de custo × % do gasto. Filtros: período, BU, previsto × realizado.

### 5 · Contas a Pagar  *(núcleo de valor)*
- Filtros: data, BU, categoria, centro de custo, busca. Listas: **vencidas / a vencer /
  pagas**, total do período.
- **Cadastrar despesa** com nome, descrição, categoria, centro, colaborador (se pessoal),
  **parcelamento** (N parcelas, **BU e método por parcela**), limite.
- **Baixa/pagamento** (preenche realizado). **Editar parcelamento.**
- **Edição em massa** (filtra → corrige lançamentos errados). Export/print.

### 6 · Vendas & contas a faturar  *(read do CA)*
- Filtros: data, busca, BU, produto/serviço, vendedor, cliente, categoria financeira.

### 7 · Cadastros
- CRUD de **categorias** (pai/filho/neto, receita e despesa), **centros de custo**, **BU**.

### 8 · Colaboradores & Fornecedores
- CRUD (nome, CPF, banco, chave pix), inativar, editar. Atrela a pagamentos de salário/bônus.

### 9 · Clientes  *(read/sync do CA)*
- Cadastrados automaticamente ao lançar vendas.

### 10 · Produtos & Serviços  *(read/sync do CA)*
- Criação de produtos e serviços vendáveis.

---

## 8. Requisitos não-funcionais

- **Segurança:** admin-only (`financeiro`), RLS por `company_id`, auditoria (`fin_audit_log`),
  sem exposição de token ao browser.
- **Multi-BU:** toda query aceita `bu_id` (ou consolidado). Parcela é a granularidade de BU.
- **Performance:** relatórios sobre snapshot + índices (`competencia`, `bu_id`, `categoria_id`,
  `status`, `data_vencimento`). Nada de N+1 na API do CA em render.
- **Robustez de entrada:** edição em massa, recorrência, duplicação, import — atrito mínimo.
- **Reconciliação:** receita sempre reconciliável contra o CA (carimbo + `ca_evento_id`).

---

## 9. Roadmap de implementação (passos detalhados)

> Cada passo tem **Objetivo**, **Entregáveis**, **Critérios de aceite (DoD)**, **Depende de**
> e **Armadilhas**. Regra geral: nada de novo arquivo sem restart do `next dev` (Turbopack
> não capta arquivo novo em HMR). Cada passo termina com `tsc --noEmit` verde e verificação
> no browser logado. Nenhum passo é commitado sem o anterior fechado.

### Fase 2 — Fundação & Cadastros

#### Passo 1 · Migration `0023_financeiro`
- **Objetivo:** materializar o schema do §5 no Postgres com integridade e segurança.
- **Entregáveis:** `supabase/migrations/0023_financeiro.sql` com **todas** as tabelas do §5
  (`business_units`, `fin_categorias`, `fin_centros_custo`, `fin_colaboradores`,
  `fin_despesas`, `fin_parcelas`, `fin_despesa_rateio`, `fin_recorrencias`,
  `fin_receita_snapshot`, `fin_orcamentos`, `fin_alertas`, `fin_audit_log`); FKs com
  `on delete` explícito; `check` constraints nos enums (status, tipo, metodo_pagamento,
  natureza, grupo_dre); `unique` de `fin_parcelas(despesa_id,numero)`,
  `fin_orcamentos(company_id,categoria_id,bu_id,competencia)`,
  `fin_receita_snapshot(ca_evento_id)`; índices de leitura (`company_id`, `bu_id`,
  `categoria_id`, `data_competencia`, `data_vencimento`, `status`); trigger `updated_at`;
  **RLS habilitado** em todas, com policy que só libera via service_role (padrão das tabelas
  0013–0022).
- **DoD:** migration aplica limpo num banco zerado E num banco com dados; `\d` mostra FKs/
  índices/RLS; rollback documentado; nenhuma tabela sem `company_id` nem sem RLS.
- **Depende de:** decisões travadas do §3 (esp. BU por parcela, cutover).
- **Armadilhas:** (a) `numeric(14,2)` em dinheiro, **nunca float**; (b) `data_competencia`
  como `date` (não timestamp) pra casar com o CA; (c) enums como `text + check` (não `enum`
  nativo, que é chato de alterar); (d) `on delete restrict` em categoria/BU (não deixar
  apagar dimensão com lançamento); (e) conferir o número da migration (próxima livre = 0023).

#### Passo 2 · Seed / import do Conta Azul + de-para BU
- **Objetivo:** popular dimensões espelhando o CA, para o DRE bater, e resolver a BU da receita.
- **Entregáveis:** script idempotente (rota admin `POST /api/financeiro/seed` ou `lib/financeiro/seed.ts`)
  que importa **categorias** (via `/financeiro/categorias-dre` + `/categorias`, preservando
  `codigo`, `grupo_dre`, hierarquia pai/filho/neto, `tipo`, `ca_categoria_id`), **centros de
  custo** (`/centro-de-custo`), e cria as 3 **BUs** (CPPEM, Colégio, Unicive). Uma **tabela/
  planilha de-para** `categoria → bu_id` revisada com o financeiro, aplicada em
  `fin_categorias.bu_id` das categorias de **receita**. `natureza` (fixa/variável)
  pré-preenchida por categoria de despesa.
- **DoD:** rodar o seed 2× não duplica (idempotente por `ca_categoria_id`/`ca_centro_id`);
  100% das categorias de receita têm `bu_id`; a estrutura DRE importada reproduz as linhas
  01…08 do DRE atual; relatório de "categorias sem BU" e "sem grupo_dre" vazio.
- **Depende de:** Passo 1.
- **Armadilhas:** **este é o passo de qualidade de dado mais crítico.** O de-para categoria→BU
  errado contamina TODO relatório — validar caso a caso com o financeiro, não inferir por
  regex do nome. Categorias novas criadas no CA depois do seed precisam de re-sync (deixar o
  seed re-executável). Hierarquia: importar pais antes dos filhos (ordenar por profundidade).

#### Passo 3 · Camada de acesso (`lib/financeiro/*`)
- **Objetivo:** isolar toda leitura/escrita atrás de funções tipadas e validadas.
- **Entregáveis:** módulos server-only por agregado (`categorias.ts`, `centros.ts`, `bus.ts`,
  `colaboradores.ts`, `despesas.ts`, `orcamentos.ts`); **schemas Zod** de input; tipos
  compartilhados; helper de contexto/gate reutilizando `can(ctx,"financeiro")`; wrapper de
  auditoria que grava `fin_audit_log` em toda escrita.
- **DoD:** nenhuma rota/UI acessa Supabase direto (sempre via `lib/financeiro`); toda escrita
  passa por Zod e gera audit; `tsc` verde.
- **Depende de:** Passo 1.
- **Armadilhas:** centralizar o gate aqui (não confiar só no middleware); todo valor monetário
  validado como decimal positivo; competência sempre no formato `AAAA-MM`.

#### Passo 4 · Aba 7 · Cadastros (BU / Categorias / Centros)
- **Objetivo:** CRUD das dimensões, com hierarquia de categoria (pai/filho/neto).
- **Entregáveis:** UI (sub-aba Cadastros no FloatingDock já existente) com árvore de categorias
  (criar/renomear/mover/inativar em 3 níveis), CRUD de centros e de BU (nome, cor, ordem);
  rotas `app/api/financeiro/categorias|centros|bus`.
- **DoD:** criar categoria neta sob filha funciona; inativar (não excluir) categoria com
  lançamento é permitido, excluir é bloqueado; reordenar reflete no DRE; mudança audita.
- **Depende de:** Passos 1–3.
- **Armadilhas:** impedir ciclo na hierarquia (categoria não pode ser pai dela mesma/descendente);
  não deixar excluir dimensão referenciada (o `on delete restrict` protege, mas dar erro
  amigável); manter `codigo`/`grupo_dre` editáveis só por quem entende (afeta DRE).

#### Passo 5 · Aba 8 · Colaboradores & Fornecedores
- **Objetivo:** cadastro de pessoas internas para atrelar despesa de pessoal.
- **Entregáveis:** CRUD (nome, CPF/CNPJ, tipo, banco/agência/conta, chave pix, cargo,
  salário-base, BU), inativar, editar; rota `app/api/financeiro/colaboradores`.
- **DoD:** criar/editar/inativar funciona; CPF/CNPJ validado; inativo some dos seletores de
  novo lançamento mas continua nos históricos.
- **Depende de:** Passos 1–3.
- **Armadilhas:** dados sensíveis (chave pix, conta) — só admin, nunca expor em client
  component sem gate; validar CPF/CNPJ de verdade.

### Fase 3 — Contas a Pagar (o núcleo de valor)

#### Passo 6 · Aba 5 · Contas a Pagar (lançamento + parcelamento)
- **Objetivo:** lançar despesa in-house com parcelamento e BU por parcela — substitui o CA.
- **Entregáveis:** formulário de despesa (nome, descrição, categoria, centro, colaborador se
  pessoal, `valor_total`, nº de parcelas); **gerador de parcelas** (cada parcela com `bu_id`,
  `metodo_pagamento`, `valor_previsto`, `data_vencimento`, `data_competencia`) com defaults
  (dividir igual, mesma BU, vencimentos mensais) mas **tudo editável por linha**; listas
  **vencidas / a vencer / pagas** com filtros (data, BU, categoria, centro, busca) e **total
  do período**; rotas `app/api/financeiro/despesas`.
- **DoD:** lançar despesa à vista (1 parcela) e parcelada (N) funciona; `valor_total = Σ
  valor_previsto` das parcelas (validação dura, bloqueia salvar se não bate); parcelas com BUs
  diferentes salvam corretas; filtros e listas conferem; status derivado certo (a_pagar/
  atrasada por data). `tsc` verde + verificação no browser.
- **Depende de:** Passos 1–4.
- **Armadilhas:** **é o passo mais trabalhoso.** Arredondamento do rateio (12x de R$100 → não
  pode somar R$99,99): jogar o centavo residual na última parcela. Transação atômica ao criar
  despesa+parcelas (tudo ou nada). Fuso/`date` sem hora pra vencimento. `status='atrasada'` é
  derivado (venc < hoje e não paga) — decidir se materializa via job ou calcula na query.

#### Passo 7 · Baixa (pagamento) + editar parcelamento + edição em massa
- **Objetivo:** registrar realizado, corrigir parcelamentos e consertar lançamentos em lote.
- **Entregáveis:** ação de **baixa** por parcela (preenche `valor_realizado`, `data_pagamento`,
  `status='paga'`; permite baixa parcial/valor diferente do previsto); **editar parcelamento**
  (mudar nº de parcelas, valores, BU, vencimento, método — re-valida `Σ = total`); **edição em
  massa** (selecionar por filtro e alterar categoria/centro/BU/competência em lote, com
  preview do que muda e confirmação).
- **DoD:** baixar parcela move pro grupo "pagas" e alimenta o realizado; editar parcelamento
  mantém a soma; edição em massa altera N parcelas numa transação e audita cada uma; desfazer
  baixa volta o estado.
- **Depende de:** Passo 6.
- **Armadilhas:** edição em massa é **perigosa** — exigir preview + confirmação, gravar audit
  de cada linha, e nunca deixar a soma das parcelas divergir do `valor_total`. Baixa parcial:
  decidir se gera saldo remanescente ou só registra o pago.

#### Passo 8 · Recorrências
- **Objetivo:** gerar automaticamente despesas mensais (aluguel, salário, assinaturas).
- **Entregáveis:** CRUD de `fin_recorrencias`; job/rota que, por competência, materializa as
  parcelas do mês a partir das recorrências ativas (idempotente — não duplica se rodar 2×).
- **DoD:** ativar recorrência gera a despesa/parcela do mês corrente; rodar de novo não
  duplica; inativar para de gerar; editar a recorrência não mexe em parcelas já geradas.
- **Depende de:** Passo 6.
- **Armadilhas:** idempotência (chave: recorrencia_id + competência); não regenerar histórico
  ao editar; dia de vencimento inválido (31 em fev) → último dia do mês.

#### Passo 9 · Orçamento & Limite + motor de alertas
- **Objetivo:** metas por categoria×BU×competência e alertas de estouro no painel.
- **Entregáveis:** CRUD de `fin_orcamentos` (orçado + limite); **motor de alertas** (trigger no
  insert/update de `fin_parcelas` OU job por competência) que grava `fin_alertas` nos dois
  gatilhos (`previsto_excede`: Previsto>Orçado; `limite_estourado`: Realizado>Limite); API pra
  listar/marcar alertas.
- **DoD:** definir orçamento e estourar o previsto/realizado gera exatamente 1 alerta aberto
  por (categoria,bu,competencia,tipo) — sem duplicar a cada lançamento; marcar como visto/
  resolvido persiste; alerta linka pro Contas a Pagar filtrado.
- **Depende de:** Passos 6–7.
- **Armadilhas:** **de-duplicar alertas** (não criar um por parcela — um por
  categoria×BU×competência×tipo, atualizando o valor); recalcular ao editar/estornar; performance
  do trigger (evitar recomputar tudo a cada insert — usar upsert no alerta).

### Fase 4 — Receita própria & DRE definitivo

#### Passo 10 · Snapshot de receita do CA
- **Objetivo:** materializar a receita do CA no nosso banco, com BU resolvida e carimbo.
- **Entregáveis:** job/rota de sync que lê contas-a-receber do CA (reusando o client validado),
  resolve `bu_id` via `fin_categorias`, faz **upsert** por `ca_evento_id` em
  `fin_receita_snapshot`, grava `sincronizado_em`; agendamento (ou trigger manual + cron).
- **DoD:** sync é idempotente (upsert, não duplica); receita do snapshot reconcilia com o CA
  na competência; `sincronizado_em` alimenta o selo de frescor; sync tolera token expirado
  (degrada, não quebra).
- **Depende de:** Passos 1–2.
- **Armadilhas:** o **atraso da API do CA** e a **corrida de refresh_token no deploy** (ambos
  já documentados em `docs/financas-modulo.md`) — sync sempre pela app (nunca refresh em
  processo separado); dedup rígido por `ca_evento_id`; não apagar snapshot em falha de sync.

#### Passo 11 · DRE v2 (merge + BU + previsto×realizado + cutover)
- **Objetivo:** DRE definitivo lendo receita (snapshot) + despesa (nossas parcelas), filtrável
  por BU, com previsto×realizado e cutover sem double-count.
- **Entregáveis:** evolução do `lib/contaazul/dre.ts` (ou novo `lib/financeiro/dre.ts`) que,
  **antes** do cutover, lê despesa do CA (como hoje) e **a partir** do cutover lê
  `fin_parcelas`; receita sempre do snapshot; filtro `bu_id`; colunas previsto e realizado;
  UI com seletor de BU.
- **DoD:** DRE consolidado (todas as BUs) pós-cutover bate com o pré-cutover na virada;
  filtrar por BU soma corretamente e o consolidado = Σ BUs; nenhum lançamento contado 2×;
  previsto e realizado conferem com Contas a Pagar.
- **Depende de:** Passos 6–7, 10.
- **Armadilhas:** **sensível a double-count** — a data de cutover tem que ser única e clara;
  testar a competência exata da virada; reconciliar contra o CA antes de confiar.

### Fase 5 — Relatórios gerenciais

#### Passo 12 · Aba 1 · Dashboards TV
- **Objetivo:** visão executiva rápida.
- **Entregáveis:** card de alertas (`fin_alertas` abertos, com link filtrado); gráfico anual
  linha receita(verde)×despesa(vermelha) com seletor de BU; gráfico fixas×variáveis por BU.
- **DoD:** alertas refletem o motor do Passo 9; gráficos trocam por BU; números batem com DRE/Caixa.
- **Depende de:** Passos 9, 11.
- **Armadilhas:** consistência com as outras abas (mesma fonte/fórmula); usar o kit de charts
  interativo (visx) do projeto, não SVG solto.

#### Passo 13 · Aba 3 · Fluxo de Caixa
- **Objetivo:** caixa mensal/diário, mais legível que o do CA.
- **Entregáveis:** visão mensal (ano) e diária (mês); filtros BU e realizado+previsto (ou só
  um); export planilha/print.
- **DoD:** saldo acumulado correto; realizado usa data_pagamento, previsto usa vencimento;
  export bate com a tela.
- **Depende de:** Passos 10–11.
- **Armadilhas:** caixa é por **data de pagamento/recebimento** (regime de caixa), não
  competência — não confundir com o DRE.

#### Passo 14 · Aba 4 · % por Centro de Custo
- **Objetivo:** distribuição percentual de custo por centro.
- **Entregáveis:** tabela centro × valor × %; filtros período, BU, previsto×realizado.
- **DoD:** percentuais somam 100%; filtros conferem com Contas a Pagar.
- **Depende de:** Passos 6–7.
- **Armadilhas:** parcelas sem centro (tratar "sem centro"); base do % (total do filtro).

#### Passo 15 · Aba 6 · Vendas & contas a faturar
- **Objetivo:** consultar vendas do CA com filtros.
- **Entregáveis:** read de `/venda/busca`; filtros data, busca, BU (via categoria), produto/
  serviço, vendedor, cliente, categoria financeira.
- **DoD:** filtros funcionam; BU derivada da categoria.
- **Depende de:** Passo 2 (de-para BU).
- **Armadilhas:** performance (paginação do CA), atraso da API (mesmo do snapshot).

### Fase 6 — Cadastros complementares (baixa prioridade)

#### Passo 16 · Aba 9 · Clientes
- **Objetivo:** listar clientes do CA.
- **Entregáveis:** read/sync de `/pessoa` (clientes); busca e filtros.
- **DoD:** lista carrega e filtra.
- **Depende de:** —. **Armadilhas:** dado do CA, read-only.

#### Passo 17 · Aba 10 · Produtos & Serviços
- **Objetivo:** listar/criar produtos e serviços vendáveis.
- **Entregáveis:** read de `/produtos` e `/servico`; (criação, se necessária, escreve no CA).
- **DoD:** lista carrega.
- **Depende de:** —. **Armadilhas:** escrita no CA sai do escopo "só receita/NF" — avaliar.

---

## 10. Contagem & mapa de risco

**Total: 17 passos, em 5 fases** (a Fase 1 — estético do DRE — já está pronta).

### Mais sensíveis (erro aqui contamina tudo)
- **Passo 1 — schema.** É a fundação: um modelo errado (esp. parcela × BU × rateio) cascateia
  por todas as abas. Merece revisão antes de rodar a migration.
- **Passo 2 — de-para categoria → BU.** Mapa errado = número de BU errado em **todo**
  relatório. Qualidade de dado crítica; validar caso a caso com o financeiro.
- **Passo 11 — DRE v2 + cutover.** Fundir duas fontes (CA + nosso) sem double-count, com data
  de corte, e ainda reconciliar contra o CA. Sensível a inconsistência silenciosa.

### Mais complexos (esforço/lógica)
- **Passos 6–7 — Contas a Pagar + parcelamento + edição em massa.** É o maior bloco de UX e
  regra: parcelas com BU/método por linha, editar parcelamento mantendo `Σ = total`, baixa
  parcial, e edição em lote com filtro. Coração do sistema e o mais trabalhoso.
- **Passo 9 — orçamento/limite/alertas.** Dois gatilhos, triggers/jobs, materialização em
  `fin_alertas`, e o vínculo alerta → lista filtrada.
- **Passo 10 — snapshot de receita.** Precisa lidar com o atraso da API do CA e a corrida de
  refresh_token no deploy (já documentados) — dedup e idempotência do sync.

### Transversal e sempre sensível
- **Segurança** (RLS, admin-only, auditoria) — é a foto interna da empresa; tratar em todo
  passo, não como fase.
- **Atrito de lançamento diário** — se o Contas a Pagar for chato de usar, o dado não entra e
  o sistema morre. UX de entrada é requisito, não enfeite.

**Recomendação de largada:** Passos **1 → 2 → 4/5 → 6** (fundação → import → cadastros →
lançar despesa com parcelamento). É o menor caminho até valor real (largar o CA nas despesas)
e já exercita as partes mais sensíveis (schema + de-para) cedo, quando é barato corrigir.
