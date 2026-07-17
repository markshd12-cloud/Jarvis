# Módulo Financeiro — Status (atualizado 2026-07-16)

Fonte única de "onde estamos". Detalhe de cada passo no `financeiro-PRD.md` (§9).

## Feito e validado

| Passo | O quê | Estado |
|---|---|---|
| 1 | Migration `0023_financeiro` — 12 tabelas (RLS service-role, sem policy) | ✅ aplicada em prod |
| 2 | Seed do Conta Azul + de-para BU (4 BUs, 117 categorias, 10 centros) | ✅ validado ao vivo |
| 3 | Camada de acesso `lib/financeiro/*` (context/gate, types, Zod) | ✅ tsc |
| 4 | Aba **Cadastros** (BU/Categorias/Centros) — CRUD + excluir + inativar | ✅ validado no browser |
| 5 | Aba **Colaboradores** — CRUD, CPF/CNPJ validado, PII gated | ✅ tsc |
| 5.1 | Vínculo com painel de Empresas (`profile_id`) + "Importar usuários" | ✅ migration `0024` aplicada |
| 6 | Aba **Contas a Pagar** — despesa parcelada, gerador de parcelas, Σ=total | ✅ tsc + validado |
| 7 | Baixa (pagamento) + editar dívida + agrupar por dívida + mini-dialog de baixa | ✅ tsc |
| 8 | Aba **Recorrências** — despesas fixas + "Gerar do mês" idempotente | ✅ tsc + clamp testado |
| 10 | Aba **Receita** — snapshot do CA (upsert por evento, idempotente) | ✅ validado: 4863/4863, reconcilia com CA |
| 11 | **DRE v2 / cutover** — despesa por competência do CA (< cutover) ou das nossas parcelas (≥ cutover); import insert-only; reconciliação; trava anti-duplicata | ✅ tsc + rotas gated (403) + dev sem erro · ⏳ aplicar `0025` + E2E logado |

**Reconciliação do snapshot (Passo 10):** nosso número bate 100% com o relatório **Contas a Receber** do
CA (out/2025 = R$117.817,00). O DRE do CA mostra R$125.271,63 — a diferença (~7,5k) é **interna ao CA**
(o DRE dele soma receita avulsa que não é título a receber e a API não expõe). Não é bug nosso. Ver
memória `contaazul-dre-api-lag`.

## Ajustes de UI aplicados (pedidos do usuário)
- Dock (FloatingDock): label agora **abaixo** do ícone (antes saía da tela).
- `SearchSelect` (`components/financeiro/search-select.tsx`): combobox com busca, **flutuante via portal**
  (não é cortado pelo overflow do dialog nem empurra conteúdo). Usado em Contas a Pagar e Recorrências.
- Dialogs largos: `DialogContent` base tem `sm:max-w-sm` → alargar exige `sm:max-w-none` + `w-[min(..,94vw)]`.
- **Scrollbar Jarvis global** auto-hide (`components/scrollbar-autohide.tsx` + globals.css): barrinha verde
  fina, invisível parada, aparece só ao rolar. Vale pro site todo.

## Falta fazer

### Passo 11 · DRE v2 / cutover — IMPLEMENTADO (2026-07-17), falta aplicar `0025` + E2E logado
Decisão de escopo: o **cutover afeta SÓ a despesa**. A **receita segue do CA ao vivo** em toda competência
(já reconcilia 100%, ver Passo 10) — isola a única superfície de risco (a despesa que estamos migrando).
- **Fallback:** `fin_dre_config.cutover_competencia` (migration `0025`). `null`/sem linha = tudo do CA
  (= comportamento de hoje). `getCutoverCompetencia` DEGRADA p/ null em erro/tabela ausente → ligar o
  código nunca quebra o DRE antes de migrar. Competência `>= cutover` → despesa das `fin_parcelas`.
- **Motor (`lib/contaazul/dre.ts`):** 2 helpers exportados `despesaCaPorCategoria` / `despesaJarvisPorCategoria`
  (ambos por `ca_categoria_id`, sinal cru — o motor subtrai → **preserva 100% o cálculo atual do CA**).
  `DreResult` ganhou `despesaFonte` + `cutover`; `invalidateDre()` limpa cache no cutover/import.
- **Import insert-only** (`lib/financeiro/import-despesas.ts`): espelha o snapshot mas grava em
  `fin_despesas`/`fin_parcelas` com `fonte='ca_import'` + `ca_evento_id` (dedup pela unique do 0023).
  NUNCA sobrescreve evento já importado (preserva baixa/edição/BU). Sem BU → cai na **"Geral"**. Batch (2 statements).
- **Reconciliação** (`lib/financeiro/reconciliacao.ts`): CA × Jarvis por grupo DRE na competência = o PORTÃO
  antes de cortar (Δ≈0 → seguro). **Trava anti-duplicata** no cadastro manual (`checarDuplicatas`):
  avisa se já há despesa mesma categoria/valor/venc±3d (não bloqueia).
- **Rotas** (gated `financeiro`, 403 ok): `dre-config` (GET/PUT), `despesas/importar` (POST),
  `reconciliacao` (GET), `despesas/duplicatas` (GET). **UI:** `dre-config-panel.tsx` (import→reconciliar→cutover)
  na aba DRE + badge de fonte no `dre-table`.
- **VALIDADO E2E (2026-07-17):** `0025` aplicada; import → reconciliação de 07/2026 **Δ = R$ 0,00 em todos os
  grupos** (228.069,28 dos dois lados). 2 bugs de runtime corrigidos no import (dedup `.in()` → 400 do PostgREST,
  virou paginação; janela estreita → virou superset `[-(meses+2),+4]`). **Falta só:** ligar o cutover na UI + commitar.
- **Nota:** receita do snapshot no DRE + previsto×realizado + filtro BU no DRE = evolução v2 posterior (opcional).

### Fase 5 — Relatórios gerenciais
- **Passo 12 · Dashboards TV** — alertas + gráfico receita×despesa por BU. Depende de 9 e 11.
- **Passo 13 · Fluxo de Caixa** — IMPLEMENTADO (2026-07-17), falta E2E logado + commit.
  Regime de CAIXA (data de pagamento/recebimento, não competência). Entradas = `fin_receita_snapshot`
  (recebido→pagamento / a receber→vencimento); saídas = `fin_parcelas` (paga→pagamento /
  prevista→vencimento; cancelada fora). Filtros: **mensal (ano) / diário (mês)**, **BU**,
  **previsto/realizado/ambos**. Acumulado parte de 0 (fluxo, não saldo bancário — sem conciliação, fora
  de escopo). **INDEPENDENTE do cutover** (lê nossas tabelas). Arquivos: `lib/financeiro/fluxo-caixa.ts`,
  `app/api/financeiro/fluxo-caixa/route.ts`, `components/financeiro/fluxo-caixa-panel.tsx`, wiring no shell
  (aba `caixa` era `ready:false` → `true`). **Bug pego e corrigido no teste:** PostgREST trunca em 1000
  linhas → adicionada paginação (`pageAll`); sem ela um ano sub-reportava. VALIDADO contra prod: 2026
  paginado = 1.386 parcelas / 3.385 receitas, saídas mensais ~R$230–255k coerentes com o DRE.
- **Passo 14 · % por Centro de Custo** — tabela centro × valor × %. Depende de 6–7 (**já pode ser feito**).
- **Passo 15 · Vendas & contas a faturar** — read de `/venda/busca` do CA com filtros. Depende de 2.

### Fase 6 — Cadastros complementares (baixa prioridade)
- **Passo 16 · Clientes** — read de `/pessoa` do CA (read-only).
- **Passo 17 · Produtos & Serviços** — read de `/produtos` e `/servico`.

### Passo 9 · Orçamento & Limite — IMPLEMENTADO (2026-07-17), falta E2E logado + commit
Aba **Orçamento & Limite** com metas por **categoria × BU × competência** (`fin_orcamentos`, tabela do
0023 — sem migration nova) e comparativo **Orçado × Previsto × Realizado × Limite** (previsto/realizado
lidos das `fin_parcelas`; flags `previsto>orçado` e `limite estourado` derivados **na leitura**, não
materializam `fin_alertas` — isso fica pro Dashboard TV / Passo 12).
- **Previsão (o pedido do usuário):** botão "Sugerir do histórico" → média mensal do custo lançado
  (`valor_previsto`) dos últimos N meses (3/6/12), pré-preenche o Orçado do próximo mês. Base = previsto
  (não realizado) p/ imunizar do atraso de baixa. `mesesComDado` como sinal de confiança.
- **INDEPENDENTE do cutover/Passo 11:** lê sempre das nossas parcelas (histórico já reconciliado no 11).
- **Arquivos:** `lib/financeiro/orcamentos.ts`, `app/api/financeiro/orcamentos/{route,[id],sugestao}`,
  `components/financeiro/orcamento-panel.tsx`, wiring no `financeiro-shell.tsx`.
- **VALIDADO (2026-07-17):** `tsc` limpo; rotas retornam 403 gated (existem/compilam); previsão 08/2026
  reproduzida contra prod = R$ 248,3k/mês, coerente com a despesa mensal do DRE (R$ 228–264k). **Falta:**
  E2E logado no browser + commit.
- **Evolução posterior (opcional):** motor que **materializa `fin_alertas`** por competência (job) p/ o card
  do Dashboard TV; tendência linear/sazonalidade na sugestão (hoje é média simples).

## Itens fora da numeração (anotados)
- **Export pra CA** — gerar planilha no formato `Planilha_Modelo_ContaAzul.xls` (é `.xls` binário OLE; abrir
  o modelo e passar os cabeçalhos quando formos construir). Garante reversibilidade "voltar pro CA".
- **Cron de automação** — sync de receita (Passo 10) + materialização de recorrências (Passo 8) rodando
  sozinhos por mês/dia. Hoje ambos são manuais (botão). As rotas já existem.

## Notas operacionais
- **Turbopack:** rota/arquivo/método novo exige restart do `npm run dev`. Sequência de restarts corrompe o
  manifest do `.next` → 404 em rotas → `rm -rf .next` + restart + "warm" (curl nas rotas) resolve.
- **Nunca** renovar o token do CA fora da app (rotaciona refresh_token do Cognito → `invalid_grant` em prod).
- Tudo escopado por `companyId`; `fin_*` é service-role only (gate `financeiro` nas rotas via `finContext`).
