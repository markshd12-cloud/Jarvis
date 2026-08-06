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

```text
competência <  2026-08  →  Conta Azul
competência >= 2026-08  →  banco próprio
```

A constante é `CORTE_BANCO_PROPRIO` em `lib/marketing/cac.ts`.

**Nunca somar as duas no mesmo mês.** As recorrências existem dos dois lados
(canceladas no CA, ativas aqui), e somar contaria o mesmo dinheiro duas vezes.

> Ao mover o corte, conferir os dois lados na competência da virada. Um corte
> cedo demais perde custo; tarde demais duplica.

---

## Dois regimes — e os dois lados andam juntos

```text
Previsto     custo lançado  ÷  vendas totais (faturadas + a faturar)
Realizado    custo PAGO     ÷  vendas FATURADAS
```

Na primeira versão o denominador era o mesmo nos dois e só o numerador mudava.
Ficava incoerente: "realizado" misturava dinheiro que saiu com venda que ainda
não virou nota, e em agosto produzia `R$ 0,00 ÷ 35 vendas = R$ 0,00` — afirmando
que adquirir cliente saiu de graça.

Agora cada regime é internamente consistente. Sem custo pago, o realizado é
**`null`**, não zero: ausência e gratuidade são coisas diferentes.

**Efeito colateral desejado.** Num mês recém-começado o realizado é baixo dos
dois lados, que é a resposta certa. A versão anterior jogava o custo do mês
inteiro sobre as vendas de cinco dias e produzia um CAC **seis vezes maior**,
que precisava de um aviso na tela para não assustar. O aviso deixou de existir
porque a distorção deixou de existir.

**Em troca**, os dois deixam de ser diretamente comparáveis (denominadores
diferentes). Preço justo: cada número passa a significar a mesma coisa dos dois
lados da divisão.

## Não há meta de CAC (decisão de 2026-08-05)

Meta de CAC é meta de **custo**, e custo não é alavanca do Marketing — quem
decide quanto se gasta em Comercial não é quem faz campanha. Cobrar meta de algo
que o time não controla produz número decorativo.

O Marketing tem metas do que controla: custo por lead, custo por conversa,
seguidores, inscritos. O CAC é **consequência** delas, e fica só como leitura.

## O que saiu da tela, e por quê

A aba mostrava receita por unidade, participação no rateio, custo alocado por BU,
"% sobre a receita" e a lista de centros de custo com valores. Isso é
controladoria — faturamento da empresa vazando para dentro do módulo de
Marketing, e a razão de a aba exigir também a permissão `financeiro`.

**Removido, o CAC passou a exigir só `marketing`.** A equipe toda vê o próprio
custo de aquisição sem ver o faturamento da empresa.

O cálculo por BU **não foi apagado**: vive em `getCac(..., { incluirBu: true })`,
opt-in porque custa uma varredura paginada de `fin_receita_snapshot`. É de lá que
sai um futuro painel no Financeiro, se alguém quiser.

---

## Atenção: o realizado está zerado

Nenhuma parcela do banco próprio tem `data_pagamento`. São **R$ 575.973,76**
lançados como previsto até julho/2027 e **R$ 0,00** realizados.

Não é bug — é despesa lançada e não baixada. Com a semântica nova isso aparece
como CAC realizado **indefinido**, não como zero.

Enquanto as baixas não acontecerem, **Previsto é o número útil** para qualquer
período de agosto em diante.

---

## BU: chave estrangeira, não palpite

No CA a unidade era adivinhada pelo **nome do centro** ("Unicive marketing" →
Unicive), e centro sem unidade no nome virava compartilhado, rateado por receita.

No banco próprio existe `fin_parcelas.bu_id` — chave estrangeira, preenchida em
100% das parcelas verificadas:

```text
CPPEM   | Comercial    R$  63.939,57      Colégio | Marketing   R$ 48.000,00
CPPEM   | Marketing    R$ 125.708,00      Unicive | Comercial   R$ 50.665,00
                                          Unicive | Marketing   R$ 27.500,00
```

A heurística de nome sobrevive só para o histórico do CA.

---

## Período

**Seletor de MÊS** (`?cacMes=AAAA-MM`, padrão o corrente): um `<input type="month">`
nativo, com setas de ‹ anterior / próximo › ao lado, porque comparar meses
vizinhos é o uso mais comum e abrir o calendário para andar um mês é atrito.

Limites: mínimo `2026-01` (antes disso não há histórico de custo) e máximo o mês
corrente — meses futuros já têm custo lançado (as recorrências vão até jul/2027)
mas nenhuma venda, e o CAC daria indefinido parecendo defeito.

**O gráfico não segue o mês escolhido.** Ele cobre os **12 meses terminando
nele**, travado no início da série. Com um mês só, "CAC por mês" seria uma barra
— não é gráfico. O custo é buscado para a janela inteira e filtrado ao mês nos
agregados do topo: uma ida ao banco, dois usos.

**Não há seletor de regime.** Previsto e Realizado aparecem os dois como cartões;
botões para alternar só mudariam qual número fica grande.

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
