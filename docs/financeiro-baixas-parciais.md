# Baixas parciais — arquitetura

Escrito em 2026-08-07. **Decisões validadas pelo requisitante em 2026-08-07.**
Ainda não implementado.

---

## O problema

Existe uma conta a pagar assim:

```
REPOSIÇÃO DE ESTOQUE CPPEM   ·   Produtos Físicos e Vestuário
A vencer                          R$ 10.000,00
```

Ela **não é uma fatura**. É um teto que vai sendo consumido:

```
R$    50,00   água sanitária
R$   200,00   vassouras
R$   130,00   papel toalha
```

Hoje só há dois caminhos, e nenhum serve:

**Pagar tudo** — marca R$ 10.000 num dia só. Falso: o dinheiro saiu aos poucos.

**Pagar com desconto** — registra como pago com abatimento e **encerra a conta**.
Também falso: não houve negociação, houve gasto parcial, e ainda há saldo.

A pergunta que falta na tela: **quanto ainda posso gastar disto?**

---

## Por que não é parcelamento

| | Parcela | Envelope |
|---|---|---|
| Quantas | conhecida na criação (3x) | descoberta ao longo do mês |
| Valor de cada | definido antes | definido na hora da compra |
| Data de cada | agendada | acontece quando acontece |

Forçar em parcelas exigiria saber, no dia 1º, que haveria uma compra de R$ 50 e
outra de R$ 200. Ninguém sabe.

---

## Decisão central: o envelope é EMERGENTE

**Não há marcador de "tipo" na despesa.** Nada muda no cadastro.

Toda conta pode receber baixa parcial. O envelope **nasce quando alguém registra
o primeiro pagamento parcial** — e a maioria das contas nunca vira envelope,
porque a maioria é paga de uma vez.

> Isto substitui a proposta anterior (campo `tipo: fatura | envelope`). Declarar
> na criação obrigaria a prever o futuro e complicaria o fluxo mais comum, que é
> o simples. A decisão migrou para o momento em que a informação existe: a hora
> de pagar.

---

## Como fica na tela

### 1 · O diálogo de pagamento

Hoje o botão **Pagar** abre um formulário com valor, data e desconto. Ganha um
seletor no topo:

```
┌─ Pagar ────────────────────────────────────────────┐
│  REPOSIÇÃO DE ESTOQUE CPPEM                        │
│  Previsto  R$ 10.000,00                            │
│                                                    │
│  ┌──────────────────┬──────────────────┐           │
│  │  Pagamento total │ Baixa parcial    │           │
│  └──────────────────┴──────────────────┘           │
│                                                    │
│  Valor       R$ 10.000,00                          │
│  Data        07/08/2026                            │
│  Desconto    (opcional)                            │
│                                                    │
│                          [ Cancelar ]  [ Pagar ]   │
└────────────────────────────────────────────────────┘
```

Com **Baixa parcial** escolhido, o formulário troca:

```
┌─ Pagar ────────────────────────────────────────────┐
│  REPOSIÇÃO DE ESTOQUE CPPEM                        │
│  Previsto  R$ 10.000,00    ·    Saldo  R$ 10.000,00│
│                                                    │
│  ┌──────────────────┬──────────────────┐           │
│  │  Pagamento total │ ▸Baixa parcial◂  │           │
│  └──────────────────┴──────────────────┘           │
│                                                    │
│  Valor       R$ 200,00                             │
│  O que foi   vassouras                             │
│  Data        07/08/2026                            │
│  Método      pix                                   │
│                                                    │
│  Saldo após esta baixa:  R$ 9.800,00               │
│                                                    │
│                    [ Cancelar ]  [ Lançar gasto ]  │
└────────────────────────────────────────────────────┘
```

Três diferenças que carregam o significado:

- **"O que foi"** é o campo que responde a pergunta do envelope. Sem ele, a lista
  de baixas vira uma pilha de valores sem história.
- **"Saldo após esta baixa"** atualiza enquanto se digita. É o retorno imediato
  de que aquilo não encerra a conta.
- O botão diz **"Lançar gasto"**, não "Pagar" — a palavra sinaliza que a conta
  continua viva.

### 2 · O card depois das baixas

```
REPOSIÇÃO DE ESTOQUE CPPEM     Produtos Físicos e Vestuário     Parcial
                                              R$ 380 de R$ 10.000
   ▓▓░░░░░░░░░░░░░░░░░░  3,8%             saldo  R$ 9.620,00

     05/08   vassouras            CPPEM   pix      R$   200,00   ✕
     05/08   água sanitária       CPPEM   pix      R$    50,00   ✕
     07/08   papel toalha         CPPEM   cartao   R$   130,00   ✕

              [ + Lançar gasto ]     [ Encerrar envelope ]
```

A barra responde de relance o que o envelope existe para responder: **quanto
ainda cabe**.

### 3 · Estouro do teto

```
REPOSIÇÃO DE ESTOQUE CPPEM                                    ⚠ Estourado
                                             R$ 10.500 de R$ 10.000
   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ 105%          excedente  R$ 500,00
```

O lançamento **não é bloqueado** — o dinheiro já saiu, e impedir o registro só
produziria despesa invisível. A barra satura, muda de cor e nomeia o excedente.

### 4 · Encerrar com motivo

```
┌─ Encerrar envelope ────────────────────────────────┐
│  Consumido   R$ 7.300,00 de R$ 10.000,00           │
│  Não gasto   R$ 2.700,00                           │
│                                                    │
│  Motivo *                                          │
│  ┌────────────────────────────────────────────┐    │
│  │ Compras do mês concluídas; saldo não será  │    │
│  │ usado.                                     │    │
│  └────────────────────────────────────────────┘    │
│                                                    │
│                   [ Cancelar ]  [ Encerrar ]       │
└────────────────────────────────────────────────────┘
```

Motivo **obrigatório**. Encerrar é o que tira a conta do "a pagar" — sem
justificativa registrada, meses depois ninguém sabe se sobrou porque economizou
ou porque esqueceram de lançar.

---

## Modelo de dados

### Tabela nova

```sql
create table public.fin_baixas (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id),
  parcela_id    uuid not null references fin_parcelas(id) on delete cascade,
  data          date not null,            -- quando o dinheiro saiu
  competencia   date not null,            -- a que mês o custo pertence
  valor         numeric not null check (valor > 0),
  descricao     text,                     -- "vassouras"
  metodo_pagamento text,
  observacao    text,
  created_at    timestamptz not null default now(),
  created_by    uuid
);
create index on public.fin_baixas (parcela_id);
create index on public.fin_baixas (company_id, data);
create index on public.fin_baixas (company_id, competencia);
```

### Alterações em `fin_parcelas`

```sql
-- novo estado entre "a pagar" e "paga"
alter table public.fin_parcelas drop constraint <check_status>;
alter table public.fin_parcelas add constraint <check_status>
  check (status in ('prevista','a_pagar','paga','parcial','atrasada','cancelada'));

-- encerramento com justificativa
alter table public.fin_parcelas
  add column encerrada_em date,
  add column encerrada_motivo text;
```

### Como o status é derivado

| Situação | Status |
|---|---|
| nenhuma baixa | `a_pagar` |
| soma > 0 e < previsto | **`parcial`** |
| soma ≥ previsto | `paga` |
| encerrada manualmente | `paga` + `encerrada_em` |

`valor_realizado` da parcela passa a ser **a soma das baixas**, recalculada a
cada inserção/remoção. Mantido como coluna (não view) porque o DRE já o lê e
migrar tudo de uma vez multiplicaria o risco.

---

## Por que cada baixa tem a PRÓPRIA data

Este é o ponto que decide o desenho.

Hoje a parcela tem **um** `data_pagamento`. Se as compras acontecem em 05/08,
20/08 e 03/09, uma data só obriga a mentir sobre duas — e **quebra o regime
Visão de Caixa** do DRE, que agrupa por quando o dinheiro se move.

O mesmo vale para a competência: a baixa **herda** a do envelope por padrão, mas
é editável. O padrão preserva o significado do envelope; a exceção existe porque
a realidade às vezes discorda.

---

## Impacto no DRE

Hoje o realizado é tudo-ou-nada:

```ts
if (r.status === "paga") { /* conta o valor cheio */ }
```

Uma parcela `parcial` com R$ 380 pagos aparece como **zero**.

Precisa virar: **somar as baixas do período**, cada uma pela sua data (Visão de
Caixa) ou competência (regime de competência).

> ⚠️ É a mudança mais delicada da proposta — mexe no número que a diretoria olha.
> Rodar em paralelo e comparar os totais antes de trocar.

### Migration retroativa

Há parcelas já pagas hoje sem nenhuma baixa. A migration cria **uma baixa para
cada uma**, copiando valor e data. O modelo fica uniforme e o DRE lê só baixas —
sem dois caminhos vivos para sempre.

### O previsto de um envelope encerrado

Encerrado com R$ 7.300 de R$ 10.000, o que o DRE deve mostrar como previsto?

**Mantemos R$ 10.000.** No regime de competência, previsto é o que foi
*planejado*, e "planejei 10 mil, gastei 7,3 mil" é justamente a informação útil.
O `encerrada_em` tira a conta do "a pagar" sem apagar o plano.

> Tensão registrada: na **Visão de Caixa**, previsto significa "vai sair do caixa
> este mês", e aí os R$ 2.700 encerrados inflam a previsão. Se isso incomodar na
> prática, o ajuste é subtrair o saldo encerrado nesse regime — mas só depois de
> ver o efeito real, não por antecipação.

---

## Rateio por BU

**Fase 1:** cada baixa **herda** o rateio do envelope. Uma despesa 50/50 tem
todas as baixas 50/50.

**Fase 2:** rateio editável por baixa — a vassoura foi para o Colégio, a água
sanitária para o CPPEM.

A fase 1 já é melhor que hoje, e a 2 só compensa se o rateio por item mudar
alguma decisão de verdade.

---

## Etapas

| # | O quê | Esforço |
|---|---|---|
| 1 | Migration: `fin_baixas`, status `parcial`, colunas de encerramento | baixo |
| 2 | Migration retroativa das parcelas já pagas | baixo |
| 3 | CRUD de baixas + recálculo de `valor_realizado`/status | médio |
| 4 | Diálogo de pagamento com o seletor total × parcial | médio |
| 5 | Card: barra de consumo, lista de gastos, remover baixa | médio |
| 6 | Encerrar com motivo | baixo |
| 7 | **DRE lendo baixas** | médio, delicado |

As etapas 1 a 6 são **aditivas** — nada do que existe hoje para de funcionar
enquanto entram. Só a 7 exige comparação antes de trocar.

---

## O que NÃO está no escopo

**Controle de estoque.** Isto registra o gasto, não a quantidade em prateleira.
"R$ 200 de vassouras" é uma linha de dinheiro, não item de inventário.

**Nota fiscal por baixa.** O campo `observacao` aceita o número, mas amarrar a
uma NF de verdade é outro projeto.

**Alçada de aprovação.** Quem pode lançar gasto é a permissão de financeiro que
já existe. Limite por usuário seria outro projeto.
