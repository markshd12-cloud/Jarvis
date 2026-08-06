# CAC — de onde vem o custo (e por que mudou)

Escrito em 2026-08-05, quando o CAC passou a ler duas fontes.

---

## O erro que motivou a mudança

O CAC lia o custo **só do Conta Azul**. Estava assim desde o início, e o
`lib/financeiro/centros-custo.ts` até justificava: *"As nossas tabelas
(`fin_despesas`) NÃO servem aqui"*.

Era verdade quando foi escrito. Deixou de ser quando as recorrências foram
importadas para o banco próprio e canceladas no CA a partir de agosto/2026.

Medido em agosto:

| Fonte | Custo Marketing + Comercial |
|---|---:|
| Conta Azul (o que o CAC via) | R$ 3.707,76 |
| Banco próprio (real) | **R$ 64.673,23** |

O CAC estava calculado sobre **6% do custo**. Pior: o erro *melhorava* o número.
As vendas continuavam vindo inteiras do CA enquanto o custo esvaziava, então o
CAC cairia mês a mês e pareceria uma eficiência que não existia.

Não foi encontrado por alerta nenhum — foi porque o usuário perguntou "isso tá
certo, já que mudamos por BU e banco próprio?".

---

## A regra: cada mês tem UMA fonte

```
competência <  2026-08  →  Conta Azul
competência >= 2026-08  →  banco próprio
```

A constante é `CORTE_BANCO_PROPRIO` em `lib/marketing/cac.ts`.

**Nunca somar as duas no mesmo mês.** As recorrências existem dos dois lados
(canceladas no CA, ativas aqui), e somar contaria o mesmo dinheiro duas vezes.

> Ao mover o corte, conferir os dois lados na competência da virada. Um corte
> cedo demais perde custo; tarde demais duplica.

---

## Três regimes, como no DRE

| Regime | O que é | Origem |
|---|---|---|
| **Meta** | o alvo cadastrado | `mkt_metas`, `metrica = 'cac'` |
| **Previsto** | o que o financeiro lançou | `valor_previsto` · `total` no CA |
| **Realizado** | o que foi pago | exige `data_pagamento` · `pago` no CA |

Os três são **sempre calculados**; o regime só escolhe o número de destaque.
Trocar de regime não deveria exigir recarregar para comparar.

**A meta de CAC é uma TAXA**, não um valor acumulável. Num período com várias
competências ela é a **média** das metas cadastradas, e meses sem meta ficam de
fora da média — entrar como zero puxaria o alvo para baixo.

**A meta é global, não por BU.** O Conta Azul não informa a unidade da venda:
existe custo por BU, mas não número de vendas por BU. Um CAC em reais por
unidade seria inventado. A ponte continua sendo `pctSobreReceita`.

---

## Atenção: o realizado está zerado

Nenhuma parcela do banco próprio tem `data_pagamento`. São **R$ 575.973,76**
lançados como previsto até julho/2027 e **R$ 0,00** realizados.

Isso não é bug — é despesa lançada e não baixada. O painel avisa quando cai
nesse caso, para o regime Realizado não ser confundido com tela quebrada.

Enquanto as baixas não acontecerem, **Previsto é o regime útil** para qualquer
período de agosto em diante.

---

## BU: chave estrangeira, não palpite

No CA a unidade era adivinhada pelo **nome do centro** ("Unicive marketing" →
Unicive), e centro sem unidade no nome virava compartilhado, rateado por receita.

No banco próprio existe `fin_parcelas.bu_id` — chave estrangeira, preenchida em
100% das parcelas verificadas:

```
CPPEM   | Comercial    R$  63.939,57      Colégio | Marketing   R$ 48.000,00
CPPEM   | Marketing    R$ 125.708,00      Unicive | Comercial   R$ 50.665,00
                                          Unicive | Marketing   R$ 27.500,00
```

A heurística de nome sobrevive só para o histórico do CA.

---

## Período

Antes: ano corrente inteiro, sem seletor. Agora `?cacJanela=` aceita `mes`,
`3m`, `6m`, `ano` (padrão), e `?cacRegime=` aceita os três regimes. Ambos na URL.

> **Cuidado que já causou bug:** `resumoVendas` devolve o ANO inteiro. O recorte
> por período é feito em `computeCac`. Usar `totais.qtd` direto só funcionava
> porque o período também era o ano — com seletor, daria custo de um mês dividido
> por vendas de doze.

---

## O que ficou de fora

- **Vendas por BU** — o CA não informa. Sem isso não há CAC por unidade em reais.
- **Centros do banco próprio sem BU no nome** — hoje são "Marketing" e
  "Comercial" apenas, e a BU vem do `bu_id`. Se alguém criar "Marketing CPPEM"
  como centro, os dois caminhos passam a concordar, sem conflito.
- **Alerta de divergência entre fontes** — nada avisa se, num mês, as duas bases
  tiverem custo (sinal de que o cancelamento no CA falhou). Vale checar ao mover
  o corte.
