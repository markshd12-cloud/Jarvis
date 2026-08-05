# Painel de Fechamento (Meta × Realizado) — arquitetura

Painel novo no módulo Financeiro: compara **o que foi planejado** com **o que de
fato aconteceu**, por competência. Nasce ao lado do DRE, sem alterá-lo.

Documento de arquitetura para validação. **Nada foi implementado.**
Escrito em 2026-08-04.

---

## 1 · Por que existe

O DRE tem sete colunas no modo completo, duas delas parecidas (Meta e Previsto).
Para **fechar o mês** — a leitura de "entregamos o que prometemos?" — sobra ruído.

A decisão de **não remover o Previsto do DRE** está justificada em
[financeiro-dre-previsto-vs-meta.md](./financeiro-dre-previsto-vs-meta.md): a
premissa de que Meta ≈ Previsto não se confirmou (julho fechou com 19,6% de
divergência e só 25% das categorias dentro de 5%), e o Previsto é o único
indicador que existe **antes** do dinheiro sair.

Este painel entrega a leitura enxuta **sem tirar nada** de quem precisa da outra.

---

## 2 · A boa notícia: quase nada de backend

Cada linha do DRE já carrega os três números:

| Campo em `DreChild` | É |
|---|---|
| `orcado` | Meta, já com o sinal do DRE (receita +, despesa −) |
| `previsto` | comprometido |
| `valor` | **Realizado** (pago/recebido) |

E o componente `Desvio` já calcula `valor − orcado` — exatamente Meta × Realizado.
Ele inclusive já é chamado assim em [dre-table.tsx:322](../components/financeiro/dre-table.tsx#L322).

**Mesma API, mesmos dados, tela diferente.** Sem migration, sem rota nova.

---

## 3 · Decisões tomadas

### 3.1 · Meta zero é alvo real *(decidido pelo requisitante)*

Existem **13 metas cadastradas com valor 0** (todas em 08/2026). Hoje o DRE não
distingue isso de "meta não cadastrada" — as duas chegam como `0` e viram `—`.

A partir daqui elas passam a ser **cobradas**: se a categoria tiver realizado, o
desvio mostra estouro.

**Consequência técnica:** `DreChild`/`DreRow` ganham `temMeta: boolean`. Não dá
para inferir pelo valor — `0` é ambíguo. A informação existe na origem
(`orcadoPorCategoriaCa` só põe no Map as categorias que TÊM linha em
`fin_orcamentos`), ela só se perde no `?? 0` de hoje.

```
meta ausente   -> temMeta: false, orcado: 0  -> "sem meta", desvio "—"
meta = 0       -> temMeta: true,  orcado: 0  -> alvo real, desvio = realizado
```

### 3.2 · Abre no último mês fechado *(decidido pelo requisitante)*

O mês corrente está sempre perto de 0% liquidado (agosto: 0 de 112 parcelas
pagas hoje) e mostraria −100% de desvio em tudo. É painel de fechamento.

**Regra:** ao ativar a aba, se a competência da URL for o **mês corrente**, troca
para o **mês anterior**. Se o usuário já navegou para outro mês, respeita.
"Último mês fechado" = mês anterior ao corrente, sem esperteza extra.

### 3.3 · Drill-down lista só o que foi pago *(decidido pelo requisitante)*

A soma do popup **fecha com a coluna Realizado** da linha clicada — mesma garantia
que o drill-down do DRE já tem com o Previsto. Mostra a data de pagamento de cada
conta.

### 3.4 · AV% sobre a receita realizada

Mantém o significado igual ao do DRE. Se fosse sobre a meta, os mesmos custos
apareceriam com percentuais diferentes nas duas telas, sem nada ter mudado.

### 3.5 · Desvio na convenção que já existe

Positivo = **melhor que o planejado**, valendo para os dois lados (faturou mais
**ou** gastou menos). É a regra do DRE; mudar aqui criaria duas leituras.

### 3.6 · Linha com realizado e sem meta aparece

Marcada como "sem meta". Foi o caso do **Google Ads em julho: R$ 7.500 gastos,
meta zero**. Esconder seria apagar gasto real — o mesmo erro que o filtro de
linhas zeradas evita ao proteger o Faturamento.

### 3.7 · A Meta sai do DRE *(decidido pelo requisitante)*

Com o painel novo assumindo a leitura de plano, a coluna **Meta** — e o **Desvio**,
que existe só para compará-la — saem do DRE. Ele volta a ser o que a operação usa
no dia a dia:

```
ANTES (modo Jarvis, com meta)
  Categoria | Meta | Previsto | AV% | Realizado | AV% | Desvio     7 colunas

DEPOIS
  Categoria | Previsto | AV% | Realizado | AV%                     5 colunas
```

**Sai dos dois regimes, não só de "competência".** Manter a Meta em
"previsto e realizado" e tirar de "competência" deixaria a mesma tabela com
colunas diferentes conforme o botão — mais confuso que hoje.

**Simplificação de brinde:** `cols` hoje tem **4 variantes** de grid, porque
Meta e Desvio aparecem condicionalmente. Sem elas, sobram 2 — modo Jarvis
(5 colunas) e modo Conta Azul (3 colunas). Some também o `mostraMeta` e a
condição `podeEditarMeta` que forçava a coluna a existir.

#### ⚠️ Consequência: o editor de meta perde a casa

A meta de **receita** só é digitável em um lugar: dentro da coluna Meta do DRE,
no grupo 01 ([dre-table.tsx:562](../components/financeiro/dre-table.tsx#L562)).
Tirar a coluna tira o editor — e sem ele não há como cadastrar meta de
faturamento, porque a tela de Orçamento & Limite trabalha pelas categorias do
Jarvis, não pelas folhas do DRE.

**Decisão:** o editor **migra para o painel de Fechamento**, na coluna Meta dele.
É o lugar natural — o painel passa a ser onde a meta se lê *e* se escreve.

Ele vai inteiro, com o que já foi corrigido hoje: grava na BU aberta (antes
gravava sempre em "Todas" e a leitura por BU não achava, devolvendo zero), e
Enter confirma sem recarregar a página.

### 3.8 · Regras herdadas do DRE, sem exceção

Para não haver duas verdades na mesma tela:

- linhas zeradas escondidas, com "mostrar zerados";
- Faturamento Bruto (grupo 01) sempre visível;
- categorias de outra BU filtradas pelo `bu_id` da categoria;
- competência, BU e regime na URL.

---

## 4 · A tela

```
┌─────────────────────────────────────────────────────────────────────┐
│ Competência: Jul/2026 ▾    BU: Todas ▾      ⬤ 87,6% liquidado       │
├─────────────────────────────────────────────────────────────────────┤
│ CATEGORIA  [mostrar zerados]      META    REALIZADO   AV %   DESVIO │
├─────────────────────────────────────────────────────────────────────┤
│ ▾ 01 Faturamento Bruto              —    249.388,53  100%       —   │
│      1.1 MENTORIAS CPPEM       sem meta   68.061,31   27,3%     —   │
│ ...                                                                  │
│ ▾ 05 Despesas Gerais         242.049,17  170.504,63   68,4%  +71.544│
└─────────────────────────────────────────────────────────────────────┘
```

**Selo de liquidação** — o % da competência que já virou dinheiro. Abaixo de 90%
vira aviso: *"agosto está 0% liquidado — o desvio abaixo não reflete a realidade"*.
Sem ele o painel mente justamente no mês em que mais vão abri-lo.

Mostra os dois lados separados, porque se comportam diferente:

```
             despesa   receita
2026-06        98,3%     99,9%
2026-07        87,6%     97,3%
2026-08         0,0%     63,5%
```

---

## 5 · Mudanças no código

### Backend — `lib/contaazul/dre.ts`

| # | Mudança | Risco |
|---|---|---|
| 1 | `DreChild`/`DreRow` ganham `temMeta: boolean` | baixo, aditivo |
| 2 | `DreResult` ganha `liquidacao: { despesa: number; receita: number }` | baixo, aditivo |
| 3 | `detalheDespesaPorCategoria` ganha `somentePagas?: boolean` | baixo |

O item 2 é o único cálculo novo: `Σ realizado / Σ previsto` da competência. Os
dois valores já são computados no mesmo passe — é uma divisão, não uma consulta.

### API

| # | Mudança |
|---|---|
| 4 | `/api/financeiro/dre/detalhe` aceita `?pagas=1` |

### Frontend

| # | Arquivo | O quê |
|---|---|---|
| 5 | `components/financeiro/fechamento-panel.tsx` | **novo** — tabela, selo, drill-down |
| 6 | `app/(app)/financeiro/financeiro-shell.tsx` | aba no dock + regra do mês padrão |
| 7 | `components/financeiro/dre-table.tsx` | **remover** Meta e Desvio; mover o `MetaCell` para o painel novo |

O item 7 é o único que mexe em tela existente. Ele **retira** código:

```
- coluna Meta e coluna Desvio (cabeçalho + células)
- `mostraMeta`, `podeEditarMeta`, e as props `competencia`/`onMetaSaved`
- `cols`: 4 variantes de grid  ->  2
- o componente `Desvio` sai do dre-table (vai junto com o MetaCell)
```

Os regimes do DRE (competência × previsto-realizado) **não mudam** — só as colunas.

---

## 6 · Passos de implementação

Cada passo é verificável isoladamente.

1. **`temMeta`** no `dre.ts` — e conferir que o DRE atual não muda de
   comportamento (hoje ele ignora o campo).
2. **`liquidacao`** no `DreResult` — validar contra os números já medidos:
   06/2026 = 98,3%, 07/2026 = 87,6%, 08/2026 = 0%.
3. **`somentePagas`** no detalhe + `?pagas=1` na rota — conferir que a soma bate
   com o Realizado da linha, em 3 cenários de BU (como foi feito no DRE).
4. **`fechamento-panel.tsx`** — tabela, selo, drill-down.
5. **Aba no dock** + regra do mês padrão.
6. **Mover o `MetaCell`** do DRE para o painel novo — e conferir que gravar
   continua funcionando na BU aberta e que o Enter não recarrega.
7. **Limpar o DRE** — remover Meta, Desvio e as 2 variantes de grid que sobram.
   Fazer só DEPOIS do passo 6: enquanto o editor não tiver casa nova, tirar a
   coluna deixa as metas de receita sem onde ser digitadas.
8. **Verificação final**: 07/2026 (com meta, 87,6%), 08/2026 (0%, avisando),
   06/2026 (sem meta nenhuma), as visões por BU e "Sem BU", e o DRE pré-cutover
   (modo Conta Azul, que nunca teve meta).

---

## 7 · Limitações que o painel NÃO resolve

Nenhuma delas é de código — são de cadastro e de rotina.

**Só é confiável onde há meta.** Hoje: 54 de 96 categorias de despesa em 08/2026,
e **nenhuma** categoria de receita antes de agosto. Junho e julho abrem com o
Faturamento inteiro "sem meta".

**Só é confiável onde há baixa.** Agosto está em 0% e vai se preencher conforme
vocês derem baixa no Jarvis. Antes, o status vinha do import do Conta Azul — que
parou na virada.

**Julho foi estabilizado à mão.** 57 parcelas vencidas e não baixadas foram
marcadas como pagas em 2026-08-04, com `data_pagamento = data_vencimento` (a mesma
convenção das que já estavam pagas). Julho passou de 39,7% para **87,6%**. As 9
restantes (R$ 24.118) têm vencimento futuro e continuam em aberto, corretamente.
Backup e rollback em `scratchpad/backup-julho-baixa.json` e
`rollback-julho-baixa.sql`.

---

## 8 · O que depende de vocês

1. **Completar as metas de despesa** — faltam 42 de 96 em agosto.
2. **Cadastrar metas de receita nos meses fechados**, se quiserem usar o painel
   retroativamente. Hoje só agosto tem.
3. **Dar baixa nas parcelas** conforme os pagamentos acontecem — é o que alimenta
   a coluna Realizado daqui pra frente.
