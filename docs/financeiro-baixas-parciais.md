# Despesa-envelope: baixas parciais e itens

Proposta de arquitetura, escrita em 2026-08-07 **para validação antes de
implementar**. Nada aqui foi construído.

---

## O problema

Existe uma conta a pagar assim:

```
REPOSIÇÃO DE ESTOQUE CPPEM   ·   Produtos Físicos e Vestuário
A vencer                          R$ 10.000,00
```

Ela **não é uma fatura**. É um **teto de orçamento** que vai sendo consumido:

```
R$    50,00   água sanitária
R$   200,00   vassouras
R$   130,00   papel toalha
…
```

Hoje o sistema só oferece dois caminhos, e nenhum serve:

**Pagar tudo** — marca R$ 10.000 como pagos num dia só. Falso: o dinheiro saiu
aos poucos, em datas diferentes.

**Pagar com desconto** — registra a parcela como paga com abatimento. Também
falso: não houve negociação, houve gasto parcial. E encerra a conta, quando na
verdade ainda há saldo a consumir.

O que falta é a pergunta central: **quanto ainda posso gastar deste envelope?**

---

## Por que isso NÃO é parcelamento

O sistema já tem parcelas, e a tentação é reusá-las. Não serve:

| | Parcela | Envelope |
|---|---|---|
| Quantas | conhecida na criação (3x) | descoberta ao longo do mês |
| Valor de cada | definido antes | definido na hora da compra |
| Data de cada | agendada | acontece quando acontece |
| O que é | dívida fatiada | teto sendo consumido |

Forçar o envelope em parcelas exigiria saber, no dia 1º, que haveria uma compra
de R$ 50 e outra de R$ 200. Ninguém sabe.

---

## A proposta: `fin_baixas`

Uma tabela nova, onde **cada pagamento real vira uma linha**:

```sql
create table public.fin_baixas (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id),
  parcela_id    uuid not null references fin_parcelas(id) on delete cascade,
  data          date not null,           -- quando o dinheiro saiu
  competencia   date not null,           -- a que mês o custo pertence
  valor         numeric not null check (valor > 0),
  descricao     text,                    -- "vassouras", "água sanitária"
  metodo_pagamento text,
  observacao    text,
  created_at    timestamptz not null default now(),
  created_by    uuid
);
```

A parcela deixa de ser "paga ou não" e passa a ter **saldo**:

```
previsto   R$ 10.000,00   (o envelope, não muda)
realizado  R$    380,00   (soma das baixas)
saldo      R$  9.620,00   (o quanto ainda cabe)
```

### O status ganha um estado

```sql
-- migration: adiciona 'parcial' ao check
check (status in ('prevista','a_pagar','paga','parcial','atrasada','cancelada'))
```

| Situação | Status |
|---|---|
| nenhuma baixa | `a_pagar` |
| soma < previsto | **`parcial`** |
| soma ≥ previsto | `paga` |

---

## Por que cada baixa precisa da PRÓPRIA data

Este é o ponto que decide o desenho.

Hoje a parcela tem **um** `data_pagamento`. Se as compras acontecem em 05/08,
20/08 e 03/09, uma data só obriga a mentir sobre duas delas.

E isso **quebra o regime Visão de Caixa** do DRE, que agrupa por quando o
dinheiro se move. Com data por baixa, cada compra cai no mês certo sozinha.

O mesmo vale para a **competência**: uma compra feita em setembro contra um
envelope de agosto é custo de agosto ou de setembro?

**Recomendação:** a baixa **herda** a competência do envelope por padrão, mas é
editável. O padrão preserva o significado do envelope; a exceção existe porque a
realidade às vezes discorda.

---

## O que muda no DRE

Hoje o realizado é all-or-nothing:

```ts
if (r.status === "paga") { /* conta o valor cheio */ }
```

Uma parcela `parcial` com R$ 380 pagos hoje aparece como **zero** no realizado.

Precisa virar: **somar as baixas do período**, cada uma pela sua data (Visão de
Caixa) ou competência (regime de competência).

> ⚠️ Esta é a mudança mais delicada da proposta. Ela mexe no número que a
> diretoria olha. Vale rodar em paralelo e comparar os totais antes de trocar.

### Compatibilidade com o que já existe

Há parcelas já pagas hoje sem nenhuma baixa. Duas saídas:

**A · Migration retroativa** — cria uma baixa para cada parcela com
`data_pagamento`, copiando valor e data. O modelo fica uniforme e o DRE lê só
baixas. **Recomendo esta.**

**B · Fallback no leitor** — se não há baixa, usa `valor_realizado` da parcela.
Mais barato agora, mas deixa dois caminhos vivos para sempre.

---

## Decisões que são suas

### 1. Sobrou saldo no fim do mês

O envelope era R$ 10.000, consumiu R$ 7.300, o mês fechou.

- **Encerrar** — ajusta o previsto para o realizado; os R$ 2.700 não serão
  gastos. O DRE fecha certo, e o previsto original fica no histórico.
- **Carregar** — o saldo vira envelope do mês seguinte.
- **Deixar aberto** — some do mês e vira pendência eterna. Não recomendo.

Minha sugestão: uma ação **"Encerrar envelope"** com motivo, que ajusta o
previsto. Simples e auditável.

### 2. Estourou o teto

Comprou R$ 10.500 num envelope de R$ 10.000.

**Permitir, com aviso.** Bloquear seria pior — o dinheiro já saiu, e impedir o
registro só produziria uma despesa invisível. O DRE mostraria realizado acima do
previsto, que é a informação verdadeira.

### 3. Rateio por BU de cada compra

O envelope pode ser 50% CPPEM / 50% Colégio. Mas a vassoura foi para o Colégio e
a água sanitária para o CPPEM.

- **Fase 1:** cada baixa **herda** o rateio do envelope. Simples, e já é melhor
  que hoje.
- **Fase 2:** rateio editável por baixa, para quem quiser a precisão.

### 4. Toda despesa vira envelope?

**Não.** A maioria é fatura mesmo — aluguel, salário, boleto. Sugiro um
**marcador na despesa** (`tipo: 'fatura' | 'envelope'`), e só o envelope ganha a
tela de baixas.

Sem esse marcador, a interface de "adicionar item" apareceria em toda conta e
poluiria o fluxo simples, que é o mais comum.

---

## Como ficaria na tela

```
REPOSIÇÃO DE ESTOQUE CPPEM        Produtos Físicos e Vestuário    Parcial
                                              R$ 380 de R$ 10.000
  ▓▓░░░░░░░░░░░░░░░░░░  3,8%              saldo  R$ 9.620,00

    05/08   vassouras              CPPEM   pix       R$   200,00
    05/08   água sanitária         CPPEM   pix       R$    50,00
    07/08   papel toalha           CPPEM   cartao    R$   130,00
                                            [ + Lançar gasto ]
```

A barra de consumo responde de relance a pergunta que o envelope existe para
responder: **quanto ainda cabe.**

---

## Esforço e ordem

| Etapa | O quê | Esforço |
|---|---|---|
| 1 | Migration: `fin_baixas`, status `parcial`, marcador de envelope | baixo |
| 2 | Migration retroativa das parcelas já pagas | baixo |
| 3 | CRUD de baixas + recálculo do status | médio |
| 4 | UI: lista de gastos, barra de consumo, "Lançar gasto" | médio |
| 5 | **DRE lendo baixas** | médio, delicado |
| 6 | Encerrar envelope | baixo |

A etapa 5 é a que exige cuidado. As outras são aditivas — nada do que existe hoje
para de funcionar enquanto elas entram.

---

## O que NÃO estou propondo

**Controle de estoque.** Isto registra o gasto, não a quantidade em prateleira.
"200 de vassouras" é uma linha de dinheiro, não um item de inventário.

**Nota fiscal por item.** Se um dia precisar amarrar cada baixa a uma NF, o campo
existe (`observacao`) mas a integração é outro assunto.

**Aprovação/alçada.** Quem pode lançar gasto num envelope é a permissão de
financeiro que já existe. Limite por usuário seria outro projeto.
