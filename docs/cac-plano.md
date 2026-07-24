# CAC (Custo de Aquisição por Cliente) — análise de viabilidade e plano

Aba nova no módulo **Marketing**. Definição do usuário:

> CAC = (custos de **Marketing** + custos de **Vendas/Comercial**) ÷ **número de vendas** do
> período, **por BU**.
> Ex.: R$1.000 comercial CPPEM + R$1.000 marketing CPPEM = R$2.000 ÷ 200 vendas = **CAC R$10**.

Levantamento feito em 2026-07-21 direto no banco e no código (não é estimativa).

---

## 1. O que EXISTE hoje (verificado)

| Peça | Estado | Fonte |
|---|---|---|
| **BUs** | ✅ CPPEM, Colégio, Unicive, Geral | `business_units` |
| **Centro de custo "Marketing" e "Comercial"** | ✅ existem e estão **ativos** | `fin_centros_custo` |
| **Despesa por centro de custo** | ✅ **ao vivo no Conta Azul** (já usado no Painel) | `resumoCentrosCusto` |
| **Investimento de mídia por marca** | ✅ CPPEM R$12.902 · Colégio R$9.667 · Unicive R$6.694 · Everton R$406 | `marketing_daily_insights.brand` |
| **Número de vendas do período** | ✅ `qtd`, `qtdFaturado`, `qtdAFaturar` | `resumoVendas` (Conta Azul) |
| **Receita por BU** | ✅ funciona | `fin_receita_snapshot.bu_id` |

## 2. O que FALTA (os bloqueios reais)

### 2.1 Despesa não tem BU — e a causa é configuração, não código
O BU de qualquer lançamento vem de um de-para **`categoria → bu_id`**
(`import-despesas.ts`, com fallback para "Geral"). Medição atual das **117 categorias**:

| BU da categoria | Qtd |
|---|---|
| SEM BU (null) | **93** |
| Geral | 11 |
| CPPEM | 6 |
| Colégio | 5 |
| Unicive | 2 |

E não é coincidência: **as 24 categorias de RECEITA estão todas mapeadas** (por isso receita por BU
funciona) e **as 93 de DESPESA estão todas sem BU** (por isso despesa cai 100% em "Geral").
👉 **Mapear as categorias de despesa é tarefa de tela (Categorias), não de desenvolvimento.**

### 2.2 `centro_custo_id` está NULL em toda despesa importada
Confirmado: `fin_despesas.centro_custo_id` = null em tudo. É o **Passo 11** (já agendado para o
início do mês). Enquanto isso, separar "Marketing" e "Comercial" **nas nossas tabelas** não é
possível — mas **o Conta Azul ao vivo entrega isso** (é o que o Painel já faz).

### 2.3 Vendas não têm BU — este é o bloqueio mais difícil
- `/venda/busca` do Conta Azul devolve cliente, tipo de item, situação e total — **sem BU/centro**.
- `fin_receita_snapshot` **tem** `bu_id`, mas cada linha é uma **parcela** (`ca_evento_id`), não uma
  venda: uma venda em 12× vira 12 linhas. **Não dá para contar vendas ali** sem um id de venda.

### 2.4 ⚠️ Risco de dupla contagem (armadilha conceitual)
O gasto do Meta Ads **também entra como despesa no Conta Azul** (fatura da Meta). Somar
"investimento do Meta Ads" **+** "centro de custo Marketing" **conta o mesmo dinheiro duas vezes**.
Só pode haver **uma fonte de verdade para o custo**.

### 2.5 ⚠️ Custo compartilhado não tem BU único
Salário da equipe de marketing/comercial, ferramentas e mídia institucional atendem **todas as
marcas**. Atribuir a categoria a **um** BU é conceitualmente errado — custo compartilhado exige
**rateio** (por receita, por headcount, ou % manual).

---

## 3. Viabilidade — em 3 níveis

| Nível | Entrega | Viável? |
|---|---|---|
| **1 · CAC consolidado (empresa)** | (Marketing + Comercial do CA) ÷ vendas do período, com série mensal e composição do custo | ✅ **HOJE, sem bloqueio** |
| **2 · Custo por BU** | Custo de marketing/comercial separado por BU | ⚠️ depende de mapear categorias (2.1) + definir rateio (2.5) |
| **3 · CAC por BU (o pedido completo)** | CAC por CPPEM / Colégio / Unicive | ❌ falta **vendas por BU** (2.3) |

**Resumo honesto:** o numerador (custo) é resolvível com configuração; o **denominador (vendas por
BU) é o verdadeiro bloqueio** e exige uma decisão de modelagem.

---

## 4. Caminhos para "vendas por BU" (decisão necessária)

| Opção | Como funciona | Esforço | Confiabilidade |
|---|---|---|---|
| **A. Produto/serviço → BU** | Passo 17 (Produtos & Serviços): cada item vendido pertence a uma BU; a venda herda a BU do item | MÉDIO | ⭐⭐⭐ melhor |
| **B. Cliente → BU** | Clientes v2: marcar a BU principal do cliente | MÉDIO | ⭐⭐ (cliente pode comprar de 2 BUs) |
| **C. Proxy por receita** | Não conta vendas: usa **receita por BU** (que já funciona) e mostra **custo ÷ receita** (% de aquisição) em vez de CAC em R$ | BAIXO | ⭐⭐ métrica diferente, mas útil já |
| **D. Contar parcelas** | Contar linhas de `fin_receita_snapshot` | BAIXO | ⭐ **enganoso** (12× = 12 "vendas") — não recomendo |

**Recomendação:** entregar o Nível 1 + a opção **C** como ponte agora, e o **A** quando o Passo 17
existir (que é o caminho correto e definitivo).

---

## 5. Plano proposto (faseado)

### Fase 1 — Aba CAC com o que é sólido hoje ✅
- Nova aba **CAC** no dock de Marketing (permissão: reusa `marketing`; avaliar `financeiro` também,
  já que expõe custo).
- **CAC consolidado** do período: custo total (Marketing + Comercial via Conta Azul) ÷ nº de vendas.
- **Composição do custo**: quanto é mídia (por marca), quanto é comercial, quanto é outros.
- **Série mensal** do CAC (tendência) + variação vs. período anterior.
- **Investimento de mídia por BU** (Meta Ads por marca → BU) — o numerador por BU já é confiável.
- **Estados-guia** onde falta dado (mesmo padrão do Painel TV): "CAC por BU requer vendas por BU —
  ver opções A/B/C".
- Seletor de período e escolha explícita da **fonte do custo** (evita 2.4).

### Fase 2 — Custo por BU
- Mapear as 93 categorias de despesa a BU (tela) **ou** implementar **rateio** configurável.
- Passo 11 (centro de custo na importação) → custo por centro nas nossas tabelas, sem depender do CA ao vivo.

### Fase 3 — CAC por BU completo
- Implementar a opção **A** (Produtos & Serviços → BU) e derivar vendas por BU.
- Aí o CAC por BU fica correto de ponta a ponta.

---

## 6. Decisões TOMADAS (2026-07-21)

| # | Decisão | Escolha |
|---|---|---|
| 1 | Fonte do custo | **Conta Azul é a verdade do custo**; Meta Ads serve só para **distribuir** o custo de mídia entre as marcas |
| 2 | Custo compartilhado | **Rateio por receita da BU** |
| 3 | Vendas por BU | **Ponte: opção C** (custo ÷ receita da BU). **Definitivo: opção A** (produto→BU) via sync incremental |
| 4 | O que conta como venda | **Faturadas + a faturar** (`qtd` total, não só `qtdFaturado`) |
| 5 | Permissão | *(a confirmar — recomendado: caixinha própria `cac`)* |

### 6.1 Alternativas da decisão 1 (documentadas para reversão futura)
A escolha "CA como verdade + Meta Ads como distribuidor" evita dupla contagem, mas há outras:

| Alternativa | Como seria | Prós | Contras |
|---|---|---|---|
| **Escolhida — CA verdade, Meta distribui** | Custo total sai do centro de custo do CA; o % por marca vem do Meta Ads | Reflete o **dinheiro real** (inclui taxas, câmbio, boleto); não duplica | Depende do lançamento estar categorizado no CA; defasagem até a fatura entrar |
| **Meta Ads verdade (mídia) + CA só p/ não-mídia** | Mídia vem da plataforma; do CA só entra o que **não** é mídia | Dado diário e granular por campanha; sem esperar fatura | Risco de **divergir do caixa** (a fatura da Meta pode ter câmbio/impostos); exige excluir a categoria de mídia do CA com precisão |
| **Somar tudo** | Meta Ads + todo o centro de custo Marketing | Simples | ❌ **Conta o mesmo dinheiro 2×** — não usar |
| **Só CA (sem Meta)** | Ignora a plataforma | Mais simples e sempre bate com o caixa | Perde a **quebra por marca/BU** — inviabiliza o CAC por BU |

> Para trocar de estratégia depois, o ponto de mudança é isolado: a função que monta o **numerador
> (custo)** do CAC. Manter essa escolha configurável (enum) desde a Fase 1.

### 6.2 Rateio por receita (decisão 2) — como funciona
Custo compartilhado (categoria sem BU ou marcada "Geral") é distribuído proporcionalmente à
**receita da BU no mesmo período**:

```
custo_alocado(BU) = custo_compartilhado × receita(BU) / receita_total
```

Exemplo: R$3.000 de custo compartilhado; receita CPPEM 60%, Colégio 30%, Unicive 10%
→ CPPEM R$1.800 · Colégio R$900 · Unicive R$300.

⚠️ Efeito colateral a comunicar na UI: **quem fatura mais absorve mais custo**, o que naturalmente
melhora o CAC de BUs pequenas. Exibir sempre o custo **direto** e o **rateado** separados, para a
leitura não enganar.

### 6.3 Por que a opção A é a melhor (decisão 3)
O **produto pertence a uma BU sem ambiguidade** (curso do CPPEM = CPPEM; matrícula = Colégio). O
cliente é ambíguo — o mesmo pai pode ser cliente do Colégio **e** comprar curso do CPPEM (a opção B
atribuiria tudo a uma BU só).

**Porém:** `/venda/busca` **não devolve os itens** (só o *tipo*: PRODUCT/SERVICE) e o cliente vem
**só como nome, sem id**. Buscar o detalhe de cada venda ao vivo é inviável (~8.000 vendas/ano).
👉 A forma correta é **sync incremental para uma tabela `fin_vendas`**, buscando o detalhe apenas das
vendas **novas** — custo pago uma vez, leitura instantânea (mesmo padrão de Meta/IG/YouTube).
