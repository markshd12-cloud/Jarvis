# Módulo Financeiro — CPPEM (protótipo)

Documentação do protótipo do **sistema financeiro gerencial** da CPPEM, uma nova
seção do sidebar separada do `/dashboard` atual. O dashboard permanece como visão
rápida; este módulo é o ambiente de **gestão e lançamento** de custos e receitas.

- **Mock v2 — `/financeiro` dentro do Jarvis (atual):** https://claude.ai/code/artifact/1b265af9-d28d-4138-b270-59ed62d8a8de
- **Mock v1 — módulo standalone (referência):** https://claude.ai/code/artifact/334b43bf-e921-4f72-a5d1-aee6c18eca18
- **PRD base:** "Sistema financeiro" (fornecido pelo requisitante em 2026-07-15).

> Objetivo: parar de depender dos relatórios do Conta Azul (que "não se conversam"
> e faltam filtros por BU). O Conta Azul permanece como **âncora fiscal** — daqui
> pra frente **só receitas + emissão de NF**; **despesas saem 100% do CA** e passam
> a viver neste módulo.

## Decisão de arquitetura

**Uma única rota `/financeiro` dentro do shell do Jarvis** (reusa `DashboardShell`
e o sidebar externo existente), com **navegação interna por sub-abas** para os 11
módulos — **não** um sidebar/shell novo. Motivos: herda auth, permissões
(`can(ctx, "financeiro")`), tema, logo e layout; adiciona só 1 item "Finanças" no
rail; os 11 módulos viram sub-abas numa página só (modelo do dashboard).

- **Acesso:** feature nova `financeiro`, **gated para admin** (dado sensível — a
  "foto" da empresa). Só admin vê o item no sidebar.
- **Chat:** balão flutuante do Jarvis (FAB) no canto inferior direito, abrindo um
  painel de conversa **com contexto financeiro** (reusa `lib/ai/financeiro-context.ts`).
  Permite perguntar "quanto o CPPEM gastou em marketing?" sem sair da tela — melhor
  que mandar o usuário pra `/chat`.
- **BUs = unidades da empresa:** **Colégio, CPPEM, Unicive** (não confundir com
  centro de custo). Todo lançamento carrega BU + centro de custo.

---

## Princípios de design (herdados do app)

O protótipo usa o **design system real** do projeto (`app/globals.css`):

| Token | Valor | Uso |
| --- | --- | --- |
| `--brand` | verde `#00FF01` (`oklch(0.8664 0.2948 142.5)`) | estado ativo, valores-chave, entradas |
| ground dark | preto puro `#000`, cards `oklch(0.205)` | fundo/superfícies |
| Semânticos | âmbar `#f5a623` (previsto/alerta), vermelho `#ff453a` (estouro/vencido) | **distintos** do accent |
| Tipo | Inter (UI) + mono tabular (`Geist Mono`) | dinheiro em colunas alinhadas |
| Charts | rampa de verdes `--chart-1..5` | gráficos |

Decisões de UI (é ferramenta, não documento): resumo antes do detalhe; estado
codificado em **chips/severidade** (não só número); previsto × realizado lado a
lado; `tabular-nums` em toda coluna monetária; tema claro/escuro via tokens.

---

## As 11 abas (PRD → protótipo)

| # | Aba | Entregue no mock | Dados que consumimos |
| --- | --- | --- | --- |
| 1 | **Dashboards TV** | KPIs (caixa, receita/despesa realizada, resultado, a receber/pagar), **card de avisos de estouro de orçamento** (lista clicável), **gráfico anual receita×despesa por BU**, sparkline de caixa 30d, donut de composição, saldos das contas | KPIs financeiros + limites por categoria + série mensal |
| 2 | **DRE** | DRE em cascata (Receita Bruta → Líquida → Lucro Bruto → EBITDA → Resultado), colunas **Previsto × Realizado × AV% × Variação**, filtro BU + data, competência/caixa | `/financeiro/categorias-dre` + contas a pagar/receber |
| 3 | **Fluxo de Caixa** | Barras entrada/saída + **linha de saldo acumulado**, toggle **mensal/diário**, realizado+previsto, KPIs (menor saldo projetado), export | eventos financeiros por período |
| 4 | **% por Centro de Custo** | Tabela dos 19 CCs com previsto/realizado, **% do total** e barra de distribuição; filtro período/BU/prev×real | rateio `centros_de_custo` dos eventos |
| 5 | **Contas a Pagar** | Sub-abas a vencer/vencidas/pagas, tabela com fornecedor·colaborador, categoria, CC·BU, **método de pagamento** (cartão N×, pix, boleto), vencimento, valor, **status com alerta de estouro de limite**, total do período, "Nova despesa", export | `/financeiro/eventos-financeiros/contas-a-pagar/buscar` |
| 6 | **Vendas & Contas a Faturar** | Vendas lançadas (receita) com filtro por produto/serviço, vendedor, cliente, categoria financeira; status de faturamento (NF emitida / a faturar). CA = âncora fiscal | `/venda/busca`, `/servico` |
| 7 | **Categorias & BUs** | Árvore de categorias **3 níveis** (pai→filho→sub-filho) com **limite de gasto**, categorias de receita, **orçamento de marketing por BU**, contagem (117 cat., 19 CC, 4 BUs) | `/categorias`, `/centro-de-custo`, tabela de BUs (nova) |
| 8 | **Colaboradores & Fornecedores** | Cadastro (nome, CPF/CNPJ, banco, chave pix), salário base, bônus/ano, BU, **inativar/editar/novo** | tabela nova (não vem do CA) |
| 9 | **Clientes** | Tabela com documento, BU principal, LTV, em aberto, situação (adimplente/inadimplente); busca | `/pessoa` / clientes do CA |
| 10 | **Produtos & Serviços** | Itens vendáveis com tipo, BU, preço, vendas/ano, receita | `/servico`, `/produtos` |
| 11 | **Configurações** | Usuários × papéis × **escopo de BU** × nível de permissão; descrição dos níveis | `lib/permissions.ts` (matriz existente) |

### Filtros globais (topbar)
BU (Todas / por unidade), **Realizado / Real+Previsto / Previsto**, período, export.
O filtro **por BU** é a lacuna central do Conta Azul que este módulo resolve.

---

## Conceitos-chave introduzidos

- **BU (Business Unit):** dimensão de rateio que o CA não tem. Todo lançamento
  (despesa/receita) carrega BU + centro de custo, permitindo DRE e fluxo por BU.
  BUs de exemplo: Reportei, Marketing, Sistemas & IA, Corporativo.
- **Previsto × Realizado:** cada despesa tem valor previsto (orçamento) e realizado
  (pago). Dashboards, DRE, fluxo e contas a pagar mostram os dois.
- **Limite por categoria + alerta:** cada categoria pode ter teto de gasto; ao
  estourar, gera aviso no Dashboard TV e badge na conta a pagar.
- **Métodos de pagamento:** cartão dividido (N×), boleto, pix, débito — para
  previsão de orçamento (uma compra em 3× vira 3 previsões futuras).
- **Vínculo a colaborador:** despesas de pessoal atreladas a uma pessoa cadastrada
  → facilita pagamento de salário/bônus e metrifica custo por pessoa.

---

## Arquitetura sugerida (implementação — ainda NÃO feita)

O mock é só visual. Para virar produto:

1. **Sidebar:** nova entrada "Finanças" (`app/(app)/financas/…`), gated por uma
   feature nova em `lib/permissions.ts` (ex.: `financeiro:gerenciar`), separada do
   `/dashboard`.
2. **Banco (Supabase) — tabelas novas** (o que não vem do CA):
   - `bus` (unidades), `orcamentos` (limite por categoria/BU/período),
     `lancamentos` (despesa/receita com BU, CC, método, parcelas, previsto/realizado),
     `parcelas_pagamento`, `pessoas_pagamento` (colaboradores/fornecedores com
     dados bancários — **PII, criptografar chave pix/CPF**).
   - Reuso de `contaazul_connections` para sincronizar categorias/CC/clientes/serviços.
3. **Ingestão:** job que puxa do CA (categorias, CC, contas a pagar/receber,
   clientes) e concilia com lançamentos manuais — o CA continua âncora fiscal.
4. **Cálculo:** reaproveitar `lib/contaazul/dashboard.ts` (DRE, fluxo, KPIs já
   existem) estendendo com dimensão **BU** e **previsto**.
5. **Charts:** migrar os SVGs do mock para o kit interativo em `components/charts/`
   (visx) — ver plano de gráficos interativos V2.

### Riscos / decisões em aberto (do próprio PRD)
- Alguém precisa **lançar vendas diariamente** para os relatórios baterem.
- Não substitui ERP real — escopo é **gestão de custos + previsão**, não fiscal.
- Modelo de dados de receita precisa ser robusto e **sem** integração de NF.

---

## Status

- [x] PRD analisado
- [x] Design system extraído do app
- [x] Mockup HTML navegável (11 abas) publicado como Artifact
- [x] Documentação (este arquivo)
- [ ] Aprovação do protótipo
- [ ] Modelagem de banco + migrations
- [ ] Implementação incremental (começar por Dashboard TV + Contas a Pagar)

---

## DRE — Atraso da API do Conta Azul (investigado 2026-07-16)

**Sintoma:** o Faturamento Bruto do DRE (`/financeiro`) vinha ~R$ 4k **abaixo** do
relatório de DRE da própria Conta Azul (localhost 133.153,64 × CA 137.195,91), sempre
nas categorias que vendem o dia todo (Turmas, Mentorias, Cursos, Unicive). As despesas/
custos batiam **ao centavo** nas 5 seções.

**Causa raiz (provada, não é bug nosso):** a API pública de eventos financeiros
(`/financeiro/eventos-financeiros/contas-a-receber/buscar`) é **eventualmente
consistente**. O relatório da *tela* da CA lê a base ao vivo; o endpoint público expõe
os lançamentos com **atraso de horas** (parece sync em lote). As vendas do dia entram aos
poucos ao longo do dia.

**Como foi provado:** um `/buscar` direto e sem cache (via a app, reusando o token válido)
mostrou `dataMaisRecente` avançar de `2026-07-15T20:51` para `2026-07-16T13:29` entre dois
reloads, com a soma subindo de 133.153,64 → 133.692,92. Ou seja: **chamar direto atualiza**,
o buraco fecha sozinho conforme a CA propaga. `semCompetencia: 0` (não era competência null);
alargar a janela de vencimento **não** recuperou nada (não era janela).

> ⚠️ Sonda 100% separada (curl) é **arriscada**: renovar o token da CA fora da app rotaciona
> o `refresh_token` do Cognito e pode derrubar a conexão de produção (`invalid_grant`).
> Teste sempre **através da app**, que já tem o token em memória com single-flight.

**O que ficou no código:**
- Selo **"Dados da Conta Azul até {carimbo}"** no topo do DRE (`components/financeiro/
  dre-table.tsx`), alimentado por `DreResult.atualizadoAte` (o lançamento mais recente que a
  API expôs — `data_alteracao ?? data_emissao ?? data_vencimento`). Deixa o atraso explícito
  em vez de parecer erro.
- Janela de vencimento **-2…+3 meses** (enxuta) em `lib/contaazul/dre.ts` `fetchEventos`.
- Fallback competência→vencimento no `acumular` (rede de segurança; hoje inerte).

**Bloco de debug (REMOVIDO — como reintroduzir se precisar diagnosticar de novo):**
Havia um bloco gated por `process.env.DRE_DEBUG === "1"` em `computeDre` que, quando ligado,
(a) fazia o `getDre` **furar o cache** (cada reload = `/buscar` fresco) e (b) logava no
servidor: `receberTotalFetch`, `somaCompetencia`, `semCompetencia`, `dataMaisAntiga`,
`dataMaisRecente` e uma `amostraUltimos` (total/comp/venc/emis/categoria dos últimos eventos).
Para recriar: no `getDre`, pular o `cache.get/set` quando a env estiver ligada; e após
`acumular(...)` em `computeDre`, `console.warn("[DRE_DEBUG]", ...)` com esses campos. Subir o
dev com `DRE_DEBUG=1 npm run dev` e ler o log do servidor a cada reload de `/financeiro`.
Para **cronometrar** o atraso da API, pollar `somaCompetencia`/`dataMaisRecente` a cada 30-60 min.
