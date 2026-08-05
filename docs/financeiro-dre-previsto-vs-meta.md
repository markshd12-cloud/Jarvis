# DRE — retirar o Previsto e pôr a Meta no lugar?

Estudo da proposta: **remover a coluna Previsto do DRE**, colocar a **Meta** na
posição dela, e passar o **Desvio** a comparar Meta × Realizado.

Premissa apresentada: *"previsto e a Meta sempre vão ser a mesma coisa, poucas as
diferenças no fim do mês"*.

Medições de **2026-08-04**, sobre os dados reais da CPPEM. Nada foi alterado.

---

## Resposta curta

**A premissa não se confirma nos dados da própria empresa.** Julho — mês fechado,
o cenário mais favorável à tese, porque é onde "as diferenças já se acertaram" —
mostra o contrário.

A proposta **não deve ser executada como está**. Há uma variante dela que resolve
o problema real (tela poluída, duas colunas parecidas) sem destruir informação:
está na seção [Alternativa](#alternativa-recomendada).

---

## A evidência

### Despesa, julho/2026 (mês fechado)

```
categorias batendo em até 5%:   15 de 60    (25%)
totais no fim do mês:  meta R$ 242.049,17  ×  previsto R$ 194.623,52   (−19,6%)
```

| Categoria | Meta | Previsto | Diferença |
|---|---|---|---|
| INSS sobre Salários – GPS | 2.052,21 | 4.308,24 | **+110%** |
| FGTS e Multa de FGTS | 2.088,52 | 3.681,64 | **+76%** |
| Terceirizado | 3.333,33 | 5.000,00 | **+50%** |
| Hora Aula Professores CPPEM | 5.330,00 | 6.918,69 | **+30%** |
| Bens de Pequeno Valor | 5.376,62 | 3.988,29 | **−26%** |
| Meta Ads | 21.385,17 | 18.513,13 | **−13%** |
| **Google Ads** | **0,00** | **7.500,00** | sem meta |
| Aluguel | 12.500,00 | 12.500,00 | 0% |
| Pró-Labore Sócios | 35.400,00 | 35.400,00 | 0% |

Três em cada quatro categorias divergiram mais de 5%, e o total do mês fechado
errou por **R$ 47 mil**. As que batem exato são justamente as de valor contratado
e fixo (aluguel, pró-labore) — onde meta e previsto vêm da mesma fonte.

### Receita, julho/2026 — o caso decisivo

```
categoria                        META      PREVISTO     REALIZADO
1.1 - MENTORIAS CPPEM            0,00     68.061,31     65.353,53
1.8 - MENSALIDADE COLÉGIO        0,00     65.546,73     65.546,73
1.0 - TURMAS PRESENCIAIS         0,00     63.444,69     62.399,91
1.5 - MATRÍCULA UNICIVE          0,00     20.869,84     18.865,72
...
TOTAIS                           0,00    249.388,53
```

**Julho fechou com R$ 249.388 de faturamento e meta R$ 0,00 em todas as
categorias.** Com a mudança proposta, o Faturamento Bruto de julho passaria a
exibir **R$ 0,00**.

Metas de receita só existem em 08/2026 (14 categorias), digitadas há dias no
editor novo do DRE. Não há histórico.

---

## Por que a premissa parece verdadeira

Ela não é ingênua — tem um fundo real. Em **agosto**, hoje:

```
DESPESA   meta R$ 248.243,46   ×   previsto R$ 238.401,95   (4%)
```

Quatro por cento. Mas isso acontece por um motivo específico: **a meta de despesa
foi construída a partir das mesmas recorrências que geram as parcelas.** Mesma
origem, resultado quase igual. É um espelho, não uma coincidência — e é também o
motivo de a Meta acrescentar pouco hoje no lado da despesa.

A semelhança some assim que a meta deixa de ser cópia da inércia: em julho, onde
as metas foram feitas de forma independente, a divergência foi de 19,6%.

---

## O que cada coluna responde

| Coluna | O que é | Quando existe | Origem |
|---|---|---|---|
| **Meta** | o que decidimos | antes do mês | digitada por uma pessoa |
| **Previsto** | o que já está comprometido | durante o mês | **calculado** das parcelas |
| **Realizado** | o que de fato saiu/entrou | na liquidação | calculado dos pagamentos |

A diferença estrutural que a proposta atropela: **Previsto é calculado e existe
para 100% das categorias com movimento. Meta é digitada e existe só onde alguém
digitou.**

Hoje: **54 de 96** categorias de despesa têm meta em agosto; a receita de julho
tem **0 de 10**.

---

## Problemas concretos da remoção

### 1 · Linhas ficariam vazias, não erradas — o que é pior

Em julho, **4 categorias tinham Previsto sem Meta** (Google Ads R$ 7.500 entre
elas) e **12 tinham Meta sem Previsto**. Sem a coluna Previsto, as primeiras
somem do DRE apesar de terem consumido dinheiro de verdade.

Um número errado alguém contesta. Um número ausente passa despercebido.

### 2 · O DRE perde a capacidade de avisar antes do pagamento

Hoje, 04/08: **Realizado = R$ 0,00** (0 de 111 parcelas pagas — os vencimentos
começam dia 5). Só o Previsto informa que **R$ 238 mil já estão comprometidos**.

Com Meta × Realizado apenas, o DRE de hoje diria "0% executado" e não permitiria
nenhuma ação. O aviso chegaria depois que o dinheiro saiu.

É por isso que o Desvio hoje compara **Previsto × Meta** — há um comentário no
código registrando a decisão: comparar com o realizado no meio do mês engana,
porque despesa ainda não paga parece economia.

### 3 · O AV% mudaria de significado

A análise vertical é calculada sobre a **Receita Bruta**. Se a coluna passar a ser
a Meta, todo percentual do DRE passa a ser "% sobre a receita **planejada**", não
sobre a real. Um custo que hoje é 12% da receita viraria 4% só porque a meta de
faturamento é três vezes o realizado. **Todos os percentuais da tela mudam de
base**, sem que nada tenha mudado na operação.

### 4 · O detalhamento por linha deixa de fechar

O popup "de onde veio esse número" soma as **parcelas** — ou seja, o Previsto. Se
a linha passar a exibir a Meta, o total do popup não bate com a linha clicada. Ou
o popup perde a função, ou precisa passar a listar... o quê? Meta não tem
composição: é um número digitado.

### 5 · A comparação com o Conta Azul morre

A reconciliação pós-cutover (`lib/financeiro/reconciliacao.ts`) confere o Previsto
do Jarvis contra o CA. Meta não é comparável com o CA — ele não tem metas.

---

## Alcance no código

Distinção que precisa ficar clara antes de qualquer mexida:

| | Ocorrências | Arquivos | Pode mexer? |
|---|---|---|---|
| **`valor_previsto`** — coluna da PARCELA | 66 | 11 | **NÃO.** É o valor de toda conta a pagar |
| **`previsto`/`avPrev`/`temPrevReal`** — coluna do DRE | 90 | 4 | sim, é o escopo real |

**"Retirar o Previsto do DRE" ≠ "retirar o previsto do sistema".** O
`valor_previsto` é o valor de cada parcela e sustenta, fora do DRE:

```
lib/financeiro/despesas.ts        Contas a Pagar
lib/financeiro/fluxo-caixa.ts     Fluxo de Caixa
lib/financeiro/painel.ts          Painel + TV
lib/financeiro/centros-custo.ts   % por Centro de Custo
lib/financeiro/orcamentos.ts      Orçamento & Limite (compara com a meta!)
lib/financeiro/reconciliacao.ts   conferência contra o Conta Azul
lib/financeiro/recorrencias.ts    materialização
lib/financeiro/import-despesas.ts importação
```

Mexer nisso quebra oito telas. O escopo verdadeiro são **4 arquivos**:

- `lib/contaazul/dre.ts` — `DreRow.previsto`, `DreChild.avPrev`, `receitaBrutaPrev`,
  `temPrevReal`, e os dois passes de cálculo
- `components/financeiro/dre-table.tsx` — colunas, `cols` (grid), `Cells`, `Desvio`
- `app/api/financeiro/dre/route.ts` — só repassa
- `app/(app)/financeiro/financeiro-shell.tsx` — `temPrevReal` chega como prop

⚠️ `temPrevReal` **não é uma flag de exibição** — ela distingue o modo Jarvis
(pós-cutover, duas colunas) do modo Conta Azul (pré-cutover, valor único). Remover
o Previsto sem tratar isso quebra a visualização de **todo o histórico anterior a
08/2026**, que só tem valor único e nunca teve meta.

---

## Prós da proposta (existem)

- **Tela mais limpa.** Sete colunas no modo com meta é muito; duas delas parecidas
  cansa a leitura.
- **Foco no plano.** Cobra o que foi decidido, não o que a inércia produziu.
- **Coerente com o Orçamento & Limite**, que já é a tela do planejado.
- **Na despesa recorrente, a perda é pequena hoje** — meta e previsto são espelhos
  (4% em agosto) porque saem da mesma fonte.

## Contras

- **Perde o alarme antecipado** — o único indicador que existe antes do pagamento.
- **Perde cobertura**: 100% das categorias → só as que têm meta digitada.
- **Apaga o histórico**: julho inteiro (receita R$ 249 mil) exibiria zero.
- **Muda a base de todos os AV%** sem aviso ao usuário.
- **Quebra o detalhamento por linha** e a reconciliação com o CA.
- **Cria dependência de disciplina**: se ninguém digitar a meta do mês, o DRE fica
  em branco. Hoje ele se preenche sozinho.

---

## Alternativa recomendada

O problema real é legítimo: **a tela tem colunas demais e duas delas se parecem.**
Isso se resolve sem destruir informação.

### Opção A — Alternador de modo (recomendada)

Um botão como o de regime (Competência × Previsto e Realizado), com dois modos:

- **Gerencial** — `Meta | Realizado | Desvio (Meta × Realizado)`. Exatamente o que
  a proposta pede, para leitura de fechamento.
- **Operacional** — `Meta | Previsto | Realizado | Desvio`. O de hoje, para
  acompanhar o mês em curso.

Custo baixo, nada é perdido, e o usuário escolhe. Preserva o histórico
pré-cutover, que não tem meta nem duas colunas.

### Opção B — Previsto some quando não acrescenta

Manter as três colunas, mas ocultar o Previsto **quando ele estiver a menos de X%
da Meta** — a linha só mostra o Previsto quando ele diverge, que é quando importa.
Resolve a poluição visual mantendo o alarme. Mais sutil de explicar.

### Pré-requisito de qualquer caminho

**Completar as metas.** Faltam 42 das 96 categorias de despesa em agosto e
**todas** as de receita em julho. Enquanto a cobertura for parcial, qualquer
leitura baseada só na Meta é incompleta por construção — e o total consolidado
não fecha.

---

## Se ainda assim for para remover: roteiro sem resquício

Ordem importa. Cada passo é verificável.

1. **Completar as metas** de todas as categorias com movimento, em pelo menos uma
   competência, para validar a leitura antes de perder o Previsto.
2. **Decidir o comportamento sem meta**: linha some, mostra "—", ou cai para o
   Previsto? (a terceira opção mantém a cobertura e é a mais segura)
3. **`lib/contaazul/dre.ts`** — manter `previsto` no tipo e no cálculo (a
   reconciliação e o popup usam), e apenas parar de expor no `DreRow` consumido
   pela tabela. **Não apagar o campo**: `detalheDespesaPorCategoria` e
   `reconciliacao.ts` continuam precisando.
4. **`dre-table.tsx`** — remover as colunas Previsto e seu AV%, refazer as 4
   variantes de `cols` (o grid é literal por variante), e mudar `Desvio` para
   `valor − orcado`.
5. **`temPrevReal`** — decidir o que fazer com o modo Conta Azul (pré-cutover).
   Sugestão: manter intacto; a mudança vale só para `jarvisMode`.
6. **AV%** — decidir a base: manter sobre a Receita Bruta **realizada** (recomendado,
   não muda o significado) ou passar para a planejada (muda tudo).
7. **Popup de detalhe** — ou vira "composição do realizado", ou passa a mostrar os
   dois totais (previsto e realizado) explicitando que a linha exibe a meta.
8. **Verificar**: DRE de 07/2026 (pré-metas), 08/2026 (com metas), 06/2026
   (pré-cutover, modo CA), e as visões por BU e "Sem BU".

---

## O que a literatura de controladoria diz

Pesquisa feita em 2026-08-04. Três linhas independentes convergem para o mesmo
ponto: **duas colunas não bastam.**

### 1 · FP&A — as duas variâncias medem coisas diferentes

O padrão internacional de Financial Planning & Analysis trabalha com
**Budget × Forecast × Actual** — exatamente Meta × Previsto × Realizado. E a razão
é precisa:

> *Actuals vs budget* mede **responsabilidade**: a unidade entregou o que se
> comprometeu a entregar? *Actuals vs forecast* mede **qualidade de modelagem**: a
> previsão estava certa? **As duas comparações são necessárias. Usar só uma
> impede distinguir um problema de desempenho de um problema de previsão.**

Ou seja: Meta × Realizado responde "erramos o plano?". Previsto × Realizado
responde "erramos a conta?". São diagnósticos diferentes, e o remédio de cada um
é outro — rever estratégia num caso, rever premissas no outro.

### 2 · O nosso "Previsto" tem nome próprio: *encumbrance*

Isto é o ponto mais forte, e vale destacar: **o Previsto do Jarvis não é uma
projeção — é valor já comprometido** (a conta existe, está cadastrada, só não foi
paga). Na contabilidade isso se chama **encumbrance accounting** (contabilidade de
compromissos), e tem três estágios reconhecidos:

```
1. Commitment   — decidiu-se gastar            (≈ nossa Meta)
2. Encumbrance  — o compromisso foi assumido   (≈ nosso PREVISTO)
3. Actual       — o dinheiro saiu              (≈ nosso Realizado)
```

E o motivo de existir o estágio 2 é literalmente o argumento deste documento:
rastrear compromissos **antes de virarem despesa**, para impedir estouro de
orçamento enquanto ainda dá para agir.

É tão reconhecido que é **obrigatório** para entidades públicas e ONGs com verba
sob as normas GASB — precisamente como mecanismo de impedir que se gaste acima do
aprovado. Em bom português, é o equivalente ao **empenho** do setor público.

Remover o Previsto do DRE é remover o estágio 2. Fica-se com "planejei" e
"gastei", sem nada entre os dois.

### 3 · Controladoria brasileira

A literatura nacional trabalha com **Real × Orçado** como base do DRE gerencial, e
também não para em duas colunas — a Treasy, por exemplo, defende três comparações
simultâneas, usando o **histórico** como terceiro eixo (Planejado × Realizado,
Planejado × Histórico, Realizado × Histórico).

**Registro honesto:** essa terceira dimensão brasileira é *histórico*, não
*previsto* — nomenclatura diferente da nossa. O que ela reforça é o princípio
("duas colunas não bastam"), não a escolha específica do terceiro eixo. Quem
sustenta o *previsto* como terceiro eixo é a literatura de FP&A e a de
encumbrance, acima.

### Fontes

- [Budget vs Forecast vs Actual — CFO Framework (K38)](https://k38consulting.com/budget-vs-forecast-vs-actual/)
- [How Do Forecasts Differ from Budgets? (FP&A Trends)](https://fpa-trends.com/article/how-do-forecasts-differ-budgets)
- [3 Essential Types of Variances (Corporate Finance Institute)](https://corporatefinanceinstitute.com/resources/fpa/types-of-variances-fpa)
- [Budget vs. Forecast vs. Projection (Corporate Finance Institute)](https://corporatefinanceinstitute.com/resources/fpa/budget-vs-forecast-vs-projection)
- [Encumbrance Accounting Explained (Tipalti)](https://tipalti.com/encumbrance-accounting-explained/)
- [What Is an Encumbrance in Accounting? (Northstar)](https://nstarfinance.com/resources/what-is-an-encumbrance-in-accounting)
- [Acompanhamento Orçamentário: Planejado × Realizado × Histórico (Treasy)](https://www.treasy.com.br/blog/acompanhamento-orcamentario-planejado-x-realizado-x-historico/)
- [Real x Orçado: disciplina mensal (VBMC Consultores)](https://vbmc.com.br/real-x-orcado-que-evita-surpresas-financeiras/)

---

## Recomendação

**Não remover.** A premissa foi testada no mês fechado da própria empresa e não se
sustenta: 25% de aderência na despesa e zero cobertura na receita.

Implementar a **Opção A** (alternador de modo) entrega o que o pedido realmente
quer — uma leitura limpa focada no plano — sem apagar o único indicador que existe
antes de o dinheiro sair, e sem depender de alguém lembrar de digitar a meta.

E, independentemente do caminho: **completar as metas** é o passo que faz a Meta
valer alguma coisa. Hoje ela cobre pouco mais da metade da despesa e nada da
receita histórica.
