# Competência × Caixa — plano aprovado

Correção contábil levantada em 2026-08-03: despesas pagas **um mês depois** do
período a que se referem (salário, aluguel, encargos, comissão) entram no mês
errado do DRE **e** do Fluxo de Caixa.

> **A regra que rege tudo:**
> **A competência decide o DRE. O pagamento decide o Caixa.**

**Status:** ✅ **implementado** (código pronto, tsc + build limpos).
Pendente: aplicar a **migration 0033** e rodar a correção dos dados (§6).

---

## 1. O problema

O salário trabalhado em **julho** é pago em **05/agosto**:

| Conceito | Mês correto | Regime |
|---|---|---|
| Custo do trabalho de julho | **julho** | competência (DRE) |
| Saída do dinheiro | **agosto** | caixa (Fluxo de Caixa) |

Hoje o Jarvis grava as duas datas no **mesmo mês** — erra nos dois regimes ao
mesmo tempo. O DRE de julho acaba comparando a **receita de julho** com o
**salário de junho** (o que foi pago em 05/julho).

### Tamanho do problema (medido em julho/2026)

| Categoria | Valor/mês |
|---|---|
| Salário | R$ 46.003,82 |
| Pró-Labore Sócios | R$ 35.400,00 |
| DAS (Simples) | R$ 20.771,18 |
| Aluguel | R$ 12.500,00 |
| Comissão | R$ 9.411,83 |
| INSS | R$ 2.648,26 |
| FGTS | R$ 2.574,14 |
| **Total** | **≈ R$ 129.300** |

Sobre ~R$ 287 mil de despesa mensal: **≈45% do custo no mês errado**.

### Medição do estado (2026-08-03)

```
Despesa  — 78 parcelas, 100% com competência = mês do vencimento (defasagem 0)
Receita  — 5.129 lançamentos, 99,8% já com competência correta (vem do CA)
```

**A receita não precisa de nenhuma mudança.**

---

## 2. Diagnóstico — o motor já está certo

| Peça | Data que usa | Regime | Correto? |
|---|---|---|---|
| **DRE** (`lib/contaazul/dre.ts`) | `data_competencia` | Competência | ✅ |
| **Fluxo de Caixa** (`lib/financeiro/fluxo-caixa.ts`) | `data_pagamento ?? data_vencimento` | Caixa | ✅ |
| **Orçamento & Limite** | `data_competencia` | Competência | ✅ |
| **Painel TV** | `data_competencia` | Competência | ✅ |

### O motor já separa os TRÊS conceitos

Verificado em `despesaJarvisPorCategoria`:

```
mapa       = TODAS as parcelas da competência, pagas ou não  → competência
realizado  = SÓ as pagas (status = 'paga')                   → liquidação
orcado     = fin_orcamentos                                  → orçamento/meta
```

Conferido contra o exemplo do revisor contábil (folha orçada 30k, fechou 32k,
paga em agosto):

| Esperado | Engine devolve | ✓ |
|---|---|---|
| Orçamento R$ 30 mil | coluna **Meta** = 30.000 | ✅ |
| Realizado por competência (julho) R$ 32 mil | coluna **"Previsto"** = 32.000 | ✅ |
| Pago em julho R$ 0 | coluna **"Realizado"** = 0 | ✅ |
| Pago em agosto R$ 32 mil | Fluxo de Caixa de agosto | ✅ |

**Conclusão: a lógica está correta; faltam a data de entrada e os rótulos.**

### A causa raiz

`materializar()` em `lib/financeiro/recorrencias.ts` força os dois no mesmo mês:

```
dataComp = `${competencia}-01`          // julho
dataVenc = `${competencia}-${dia}`      // 05/julho  ← deveria ser 05/agosto
```

No Contas a Pagar manual dá para corrigir (a coluna Competência é editável),
mas exige fazer isso em toda parcela. Na recorrência é **impossível**.

---

## 3. Decisões tomadas

| # | Questão | Decisão |
|---|---|---|
| 1 | Aluguel adiantado ou vencido? | **Vencido** (mês seguinte) |
| 2 | Quais têm defasagem +1? | Salário, Pró-Labore, Aluguel, FGTS, INSS, DAS, Comissão. Assinaturas → 0 |
| 3 | Padrão por categoria? | ❌ **NÃO** — recusado. Só no lançamento/recorrência |
| 4 | Competência obrigatória? | ✅ **SIM** — sem cópia silenciosa do vencimento |
| 5 | Coluna de pagamento no DRE | **Opção 2** — o que foi pago *daquela competência* |
| 6 | Receita muda? | ❌ Não (99,8% já correta) |
| 7 | Materializar qual competência? | A do mês corrente; o vencimento cai adiante |
| 8 | Corrigir as parcelas existentes? | ✅ Sim — 6 parcelas, R$ 16.166,00 |

### Por que a Opção 2 (e não "pago dentro do mês")

DRE de julho, com salário de junho R$30k (pago 05/07) e de julho R$32k (pago 05/08):

| | Previsto | Coluna de pagamento | Problema |
|---|---|---|---|
| **Opção 1** (pago dentro de julho) | 32.000 | **30.000** | são salários de **meses diferentes** → lê-se "economizei 2 mil", o que é falso |
| **Opção 2** (da competência julho) | 32.000 | **32.000** | mesmo mês, comparável ✅ |

**Regra:** numa tabela por competência, todas as colunas têm que ser do mesmo mês.

E "quanto paguei dentro de julho" **já existe** — é o **Fluxo de Caixa**. Não é
preciso escolher: cada leitura tem o seu lugar.

| Pergunta | Onde responder |
|---|---|
| "Quanto custou julho?" | **DRE** (competência) |
| "Quanto saiu do banco em julho?" | **Fluxo de Caixa** |

---

## 4. A estrutura aprovada

### 4.1 Onde fica a defasagem

**Migration 0033** (aditiva) — **só na recorrência**:

```
fin_recorrencias.defasagem_meses  int not null default 0
```

Não existe campo em `fin_categorias` (recusado na decisão #3).

**Por quê só na recorrência:** ela gera despesa sozinha todo mês, sem ninguém
olhando — precisa saber a regra. O lançamento manual tem uma pessoa na frente,
que informa a competência na hora.

### 4.2 Contas a Pagar — competência obrigatória

**Hoje:** o formulário copia o vencimento para a competência, em silêncio.

**Depois:** a competência é **escolha explícita**, com rótulos que impedem a
troca das datas (inverter as duas troca DRE e caixa de lugar, sem aviso):

```
Competência — a que mês esta despesa se refere
Vencimento  — quando ela será paga
```

No bloco de parcelamento, um seletor aplicado às parcelas geradas (comodidade
para não editar 12 linhas):

```
Valor da parcela | Nº parcelas | 1º vencimento | Competência: [Mês anterior ▾]
```

Continua sendo decisão **daquele lançamento** — nada é herdado de categoria.

### 4.3 Recorrência — o seletor

```
Descrição: Salário
Dia de vencimento: 5
Competência: [ Mês anterior ▾ ]     ← nova
```

Regra na materialização:

```
competência = mês M, dia 01
vencimento  = mês (M + defasagem), dia X   (clamp no último dia do mês)
```

Materializando julho com defasagem +1 e dia 5 → **competência 01/07** ·
**vencimento 05/08**.

### 4.4 Colunas do DRE

**Decisão do requisitante:** a **Meta é exclusiva de faturamento** — não existe
meta de despesa. Para despesa, *"a meta é o Previsto: justamente as contas que
aparecem para pagar em Contas a Pagar e Recorrência"*.

Por isso **"Previsto" MANTÉM o nome** (a proposta de renomear para "Competência"
foi descartada). Só a coluna de pagamento muda:

| Hoje | O que É | Passa a ser |
|---|---|---|
| Meta | meta de faturamento (só receita) | **Meta** (mantém) |
| Previsto | tudo gerado no mês, pago ou não | **Previsto** (mantém) |
| **Realizado** | só o que foi pago daquela competência | **Liquidado** + **% liq.** |

O AV% da coluna de pagamento vira **% liquidado** — ali o que importa não é o
peso sobre a receita, e sim quanto daquele custo já saiu do caixa:

```
Salário    Previsto 32.000    Liquidado 32.000   100%
Aluguel    Previsto 12.500    Liquidado      0     0%   ← vence 05/08
```

**Desvio = Previsto − Meta** (nunca o Liquidado).

> ⚠️ **O resultado do mês é a coluna Previsto.** O Liquidado mostra quanto
> daquela competência já foi pago. Sem isso, quem lê no fechamento acha que
> "faltou lançar".

⚠️ **Liquidado ≠ Fluxo de Caixa.** O salário de julho pago em 05/08 aparece no
**Liquidado de julho** (é dessa competência) e no **Fluxo de Caixa de agosto**
(é quando o dinheiro saiu). Leituras diferentes, não podem ser confundidas.

### 4.5 Comportamento no tempo (alinhar com o time)

| Momento | Competência (julho) | Liquidado (julho) |
|---|---|---|
| Ao lançar | 32.000 | 0 |
| 31/07 — fecha o mês | 32.000 | **0** ← ainda não pagou |
| 05/08 — paga | 32.000 | **32.000** |

**O DRE de julho continua se preenchendo depois que julho fecha.** O custo não
muda (é 32.000 desde o lançamento); o que evolui é a liquidação. É o
comportamento correto do regime de competência.

---

## 5. Escopo — o que NÃO muda

- ❌ Nenhum cálculo do DRE, Fluxo de Caixa, Orçamento ou Painel TV
- ❌ Receita (99,8% já correta, vinda do CA)
- ❌ Rateio por BU, centro de custo, baixa de parcela, cutover
- ❌ Nenhuma coluna nova de cálculo — só renomeação e o percentual

Toda a mudança está em **onde o dado nasce** + **como as colunas se chamam**.

---

## 6. Correção dos dados existentes

**6 parcelas** de competência agosto que são, na verdade, de **julho**
(total **R$ 16.166,00**) — só a competência muda; o vencimento 05/08 já está certo:

| Categoria | Descrição | Valor |
|---|---|---|
| Pró-Labore Sócios | Pro-Labore Socio | R$ 3.500,00 |
| Pró-Labore Sócios | Pro-Labore Socio - Elias Glaucio | R$ 3.500,00 |
| Pró-Labore Sócios | Pro-Labore Socio - Andrezza Mota | R$ 4.300,00 |
| Salário | VENDEDOR 1 - VICTOR WILLIAN | R$ 1.622,00 |
| Salário | VENDEDOR 2 - JULYA CABRAL | R$ 1.622,00 |
| Salário | VENDEDOR 3 - PABLO CHOI | R$ 1.622,00 |

`comp 01/08 · venc 05/08` → **`comp 01/07 · venc 05/08`**

As outras 3 de agosto (Onvox, Festividades, Buzina) **ficam** — defasagem 0.

### As 9 recorrências ativas — defasagem a configurar

| Recorrência | Defasagem |
|---|---|
| Pro-Labore Itallo Mota · Elias Glaucio · Andrezza Mota | **+1** |
| VENDEDOR 1 · 2 · 3 | **+1** |
| PLATAFORMA DE LIGAÇÃO ONVOX | 0 |
| Festividades e Brindes Comercial | 0 |
| Buzina Comercial | 0 |

Todas com `inicio_competencia = 2026-08`. Ao marcar +1 nas seis primeiras, a
materialização de agosto passará a gerar **competência 08 · vencimento 05/09**.

---

## 7. Passos de implementação

| # | Passo | Onde |
|---|---|---|
| 1 | **Migration 0033** — `defasagem_meses` em `fin_recorrencias` | `supabase/migrations/` |
| 2 | **Materialização** desloca o vencimento pela defasagem | `lib/financeiro/recorrencias.ts` |
| 3 | **Seletor de competência** no form da recorrência | `components/financeiro/recorrencias-panel.tsx` |
| 4 | **Competência obrigatória** + seletor no Gerar parcelas | `components/financeiro/contas-pagar-panel.tsx` |
| 5 | **Renomear colunas** + percentual de liquidação | `components/financeiro/dre-table.tsx` |
| 6 | **Corrigir as 6 parcelas** (competência agosto → julho) | script pontual |
| 7 | **Validar** — tsc, build, e conferir DRE julho × agosto antes/depois | — |

**Rollback:** migration aditiva com bloco ROLLBACK próprio; backup do código em
`c:\Projetos\jarvis-backups\2026-08-03\` e tag `backup/pre-defasagem-20260803`.

---

## 8. Dúvidas — todas resolvidas

1. **Nome da coluna do meio** → **"Previsto" mantido.** A Meta é exclusiva de
   faturamento; para despesa, o Previsto *é* a meta (as contas lançadas a pagar).
2. **Seletor fechado ou livre?** → **Fechado**: *mesmo mês* / *mês anterior*.
   Cobre 100% dos casos e elimina erro de digitação.
3. **Defasagem negativa** (pagar adiantado)? → Coluna aceita `-12..12` no banco,
   mas a **UI expõe só as duas opções**. No dia em que aparecer um caso de
   pagamento antecipado, é só acrescentar a opção — sem migration.

## 9. O que foi implementado

| Arquivo | Mudança |
|---|---|
| `supabase/migrations/0033_recorrencia_defasagem.sql` | coluna `defasagem_meses` (aditiva, com ROLLBACK) |
| `lib/financeiro/recorrencias.ts` | `vencimentoDaCompetencia()` + uso na materialização + schema |
| `lib/financeiro/types.ts` | `FinRecorrencia.defasagem_meses` |
| `components/financeiro/recorrencias-panel.tsx` | seletor **Competência \*** obrigatório |
| `components/financeiro/contas-pagar-panel.tsx` | seletor **Competência \*** obrigatório no Gerar parcelas; competência = vencimento − defasagem |
| `components/financeiro/dre-table.tsx` | `Realizado` → **Liquidado** + coluna **% liq.**; tooltips nas 3 colunas |

**Testes de `vencimentoDaCompetencia` (10/10):** defasagem +1 comum; virada de
ano (dez→jan); dia 31 caindo em fevereiro (28 e 29 bissexto); dia 31 → abril 30;
defasagem 0; defasagem 2; defasagem −1 incluindo jan→dez do ano anterior.

`tsc` limpo · `next build` OK · lint sem apontamento novo.

### Passos que faltam (dependem da migration)

1. Aplicar a **migration 0033** no Supabase
2. Marcar **defasagem +1** nas 6 recorrências de folha (Pró-Labore ×3,
   Vendedores ×3) — as outras 3 ficam em 0
3. Corrigir as **6 parcelas** de competência agosto → julho (§6)
4. Conferir o DRE de julho × agosto antes/depois

---

## Referências

- Cutover CA → Jarvis: [`financeiro-cutover.md`](./financeiro-cutover.md)
- Estado do módulo: [`financeiro-status.md`](./financeiro-status.md)
- PRD do módulo: [`financeiro-PRD.md`](./financeiro-PRD.md)
