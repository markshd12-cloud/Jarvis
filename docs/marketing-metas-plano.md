# Metas de Marketing — plano de aproveitamento

Escrito em 2026-08-11 a pedido do requisitante. Reúne tudo que dá para fazer com
metas no módulo de Marketing: o que consertar na tela que existe, o que ainda não
tem meta, e onde as metas deveriam aparecer fora da própria aba.

O estudo de **viabilidade** de cada métrica (o que a API entrega, o que arredonda,
o que mente) está em [`marketing-metas.md`](marketing-metas.md). Este documento é
o passo seguinte: assumindo que os números existem, **como extrair valor deles**.

---

## 0 · O estado hoje, medido

A aba Metas existe e funciona. `mkt_metas` tem **3 metas cadastradas**, todas de
agosto/2026, contra **11 alvos** disponíveis:

| Alvos | Quantos | Preenchidos |
|---|---|---|
| Custo por resultado (1 por marca do Meta Ads) | 4 | 2 |
| Seguidores do Instagram (1 por perfil) | 5 | 1 |
| Inscritos do YouTube (1 por canal) | 2 | 0 |

As duas metas de custo estão calibradas — Unicive R$ 7,00 contra R$ 7,85 reais,
CPPEM Concursos R$ 8,00 contra R$ 10,76. São metas úteis: apertadas o suficwiente
para cobrar, próximas o suficiente para serem alcançáveis.

**A terceira está medindo outra coisa.** A conta do CPPEM Concursos tem meta de
**110.000**, mas a métrica é *ganho no mês*, não total:

```
Meta      110.000
Atual       1.040   (ganho de 01 a 11/08)
Desvio   −108.960   em vermelho
```

O perfil tem 93.175 seguidores. Quem cadastrou queria "chegar a 110 mil"; a tela
entendeu "ganhar 110 mil neste mês". O cabeçalho do bloco já diz, com todas as
letras, *"Ganho de seguidores no mês (não o total)"* — e não bastou.

Isso importa além do erro isolado: **é a mesma pessoa que acertou as duas metas de
custo.** Não é descuido de quem preencheu. É a tela que pede um número sem mostrar
a régua.

---

## 1 · Princípios

Antes das funcionalidades, as regras que decidem o que entra e o que não entra.
Elas já governam o código atual e vale mantê-las explícitas, porque quase toda má
ideia de meta esbarra em uma delas.

### 1.1 · Meta só do que o time controla

O **CAC ficou de fora de propósito** (decisão de 2026-08-05, registrada em
`lib/marketing/metas.ts`): é meta de custo, e quem decide o quanto se gasta em
Comercial não é quem faz campanha. Cobrar meta de algo que o time não controla
produz número decorativo — e pior, ensina que meta é enfeite.

O Marketing tem meta do que ele move: custo por lead, custo por conversa,
seguidores, inscritos. O CAC é **consequência** dessas metas e vive como leitura
na aba própria.

O mesmo teste vale para qualquer métrica nova: *se o número piorar, esta equipe
consegue fazer algo a respeito na semana seguinte?* Se não, não é meta dela.

### 1.2 · Teto e piso, com sinal único

Custo é **teto** (menor é melhor); seguidor é **piso** (maior é melhor). O código
já normaliza o desvio para "positivo = melhor que o planejado" nos dois casos, a
mesma convenção do DRE. Isso é deliberado: sem ela, o leitor precisa lembrar a
direção de cada linha antes de saber se o verde é bom.

A `direcao` vem da métrica, nunca do usuário — deixá-la editável só criaria linhas
com a cor invertida.

### 1.3 · Ausência de meta ≠ meta zero

Alvo sem meta aparece com o campo vazio, não sumido. Esconder o que falta
preencher é esconder exatamente a informação mais acionável da tela. Hoje 8 dos 11
alvos estão nesse estado, e é bom que apareçam.

### 1.4 · Taxa e acumulado não se comparam do mesmo jeito

Este é o princípio que a tela ainda **não** respeita, e está detalhado em §2.1.

---

## 2 · A tela de Metas — o que mudar

Em ordem de valor. Os dois primeiros itens evitam decisão errada; os demais
reduzem atrito.

### 2.1 · Distinguir taxa de acumulado (o mais importante)

A tabela hoje trata dois tipos de métrica com a mesma régua:

| Tipo | Métricas | Comparável no meio do mês? |
|---|---|---|
| **Taxa** | custo por resultado | **Sim.** R$ 7,85 por lead é R$ 7,85 no dia 5 ou no dia 30 |
| **Acumulado** | seguidores, inscritos | **Não.** 11 dias de ganho contra a meta do mês inteiro é sempre injusto |

No dia 11 de agosto, 1.040 seguidores ganhos são ~94/dia, o que projeta ~2.900 no
mês. Se a meta fosse 2.000, o time está **à frente** — e a tela pintaria vermelho.

Toda meta acumulada nasce vermelha no dia 1º e vai esverdeando. Isso treina as
pessoas a ignorar a cor durante três semanas, que é o mesmo que não ter meta.

**Proposta:** para métricas acumuladas, comparar contra a **meta proporcional aos
dias decorridos**, e mostrar as duas leituras:

```
Seguidores · CPPEM Concursos
meta 2.000 no mês   ·   esperado até hoje 710   ·   atual 1.040   ·   +330 no ritmo
projeção do mês 2.930                                              ▲ 46% acima
```

Detalhes que a implementação precisa acertar:

- **O mês corrente é o único que se projeta.** Mês fechado compara direto — nada
  de projetar julho.
- **O denominador é o dia da última coleta, não o de hoje.** A série do Instagram
  é um snapshot diário e o YouTube Analytics tem ~2 dias de atraso; dividir por
  "hoje" subestimaria o ritmo e pintaria de vermelho um mês saudável.
- **Ritmo linear é aproximação, e a tela deve dizer isso.** Campanha concentrada
  no fim do mês quebra a hipótese. Serve para orientar, não para julgar.

### 2.2 · Mostrar a régua ao lado do campo

A causa direta do erro dos 110.000. No bloco de seguidores e inscritos, exibir a
base ao lado da meta:

```
CPPEM Concursos   @cppemconcursos
hoje 93.175 seguidores  ·  ganho médio dos últimos 3 meses: 1.180/mês
meta de ganho [        ]
```

Com "ganho médio 1.180/mês" à vista, ninguém digita 110.000. E quem quiser mesmo
chegar a 110 mil vê que precisa de ~14 meses no ritmo atual — que é a informação
que a pessoa realmente queria.

**Complemento barato:** avisar quando o número digitado for implausível — "essa
meta é 93× o ganho médio; você quis dizer o total de seguidores?". Aviso, não
bloqueio: metas ambiciosas existem, e a tela não deve decidir pelo gestor.

### 2.3 · Copiar as metas do mês anterior

Onze alvos, três preenchidos. Todo mês alguém precisaria redigitar tudo à mão — e
é exatamente por isso que a tabela está pela metade.

Um botão **"repetir metas de julho"** que preenche o que ainda está vazio, sem
tocar no que já foi digitado. Variante útil: "repetir com +10%", para quem trabalha
com crescimento composto.

Esse é o item de maior efeito sobre a **adoção**. Os outros melhoram a qualidade
de metas que existem; este faz as metas existirem.

### 2.4 · Setas de mês

A competência troca por `<select>`. Contas a Pagar, Recorrências e Colaboradores
já usam setas ‹ mês › — a aba de Metas ficou fora do padrão. Manter o `<select>`
ao lado, para saltos longos.

### 2.5 · Resumo no topo

Uma linha antes dos blocos, respondendo sem rolagem:

```
3 de 11 metas definidas  ·  2 dentro  ·  1 fora  ·  8 sem meta
```

Com filtro rápido "só as que estão fora" — que é a visão que interessa numa
reunião de acompanhamento.

### 2.6 · Histórico da meta

Hoje a tela é um retrato do mês. Não dá para responder "batemos a meta de CPL em
julho?" sem trocar a competência e memorizar.

Uma coluna com os últimos 3–6 meses — sparkline ou três números — transforma a
tela de fotografia em série. É o que distingue "estamos ruins" de "estamos
piorando", que são conversas diferentes.

### 2.7 · Meta anual, derivando as mensais

Para métricas acumuladas, a pergunta de gestão raramente é mensal. "Quero 110 mil
seguidores até dezembro" é o pedido real — e a tela força a traduzir para ganho
mensal, na cabeça, todo mês.

Permitir cadastrar o **alvo anual** e derivar as mensais (linear, ou com peso por
sazonalidade) resolveria o problema dos 110.000 na origem, em vez de avisar depois.

Fica registrado como direção, não como próximo passo: exige coluna nova em
`mkt_metas` e uma decisão sobre o que acontece quando um mês fura (redistribui o
que falta ou mantém o plano original?).

---

## 3 · O que ainda não tem meta

Os 11 alvos atuais cobrem Meta Ads, Instagram e YouTube por **volume**. Há três
territórios inteiros sem meta nenhuma.

### 3.1 · GA4 / Site — o buraco maior

`lib/marketing/ga4.ts` já lê sessões, usuários, novos usuários, taxa de
engajamento, duração média, canais de aquisição, origem/mídia, campanhas e páginas
de entrada. **Nenhuma dessas tem meta.**

Candidatos naturais: sessões orgânicas no mês (piso), taxa de engajamento (piso),
% de sessões sem atribuição de UTM (teto — é métrica de *higiene*, e das mais
acionáveis, porque depende só de disciplina no link).

> ⚠️ **Conversões do GA4 estão bloqueadas.** Medido nesta mesma linha de trabalho:
> a propriedade tem **zero** eventos-chave configurados. Meta sobre conversão do
> site daria zero permanente. Isso é configuração no GA4 (gratuita), não código —
> e precisa acontecer antes de qualquer meta desse tipo.

### 3.2 · Qualidade, não só volume

Todas as metas de hoje contam quantidade. Faltam as que medem se a quantidade
presta:

- **Instagram:** alcance, taxa de engajamento e o funil (alcance → engajou →
  perfil → clique na bio). Um perfil pode ganhar seguidores e perder alcance.
- **YouTube:** watch time e retenção média. Inscrito que não assiste não vale o
  mesmo que inscrito que assiste — e o canal já mostrou saldo negativo em julho,
  o que uma meta só de ganho bruto teria escondido.
- **Meta Ads:** CTR e frequência. Frequência alta é o sinal antecedente de custo
  por lead subindo; meta de teto nela cobra antes do estrago.

Nenhum desses exige integração nova — todos já são lidos e cacheados.

### 3.3 · O elo que falta: lead → matrícula

Hoje o Marketing tem meta até o **lead**. O que acontece depois (o lead vira
matrícula?) não tem meta aqui — e o CAC, que seria a ponte, foi excluído com razão
(§1.1).

A métrica honesta seria **taxa de conversão de lead em matrícula**, que o Marketing
influencia pela *qualidade* do lead, mesmo sem controlar o fechamento. Fica como
questão aberta, porque depende de um dado que hoje não existe ligado: o Conta Azul
não informa a origem da venda.

Registrado como pendência de **gestão**, não de engenharia.

---

## 4 · Onde as metas deveriam aparecer fora desta tela

Metas cadastradas e nunca vistas não mudam comportamento. Os quatro destinos, do
mais pronto ao mais distante:

| Destino | O que faria | Estado |
|---|---|---|
| **Chat** | responder "estamos dentro da meta?" com alvo, atual e desvio | `getMetasComAtual()` já devolve pronto; falta o bloco de contexto (~25 linhas) |
| **Painel** | semáforo com a pior meta primeiro | proposto em `marketing-fase3.md`; depende do Painel existir |
| **Alertas** | avisar quando o desvio passar de −20%, sem ninguém abrir a tela | regra simples sobre dado já carregado |
| **Modo TV** | slide 2 do carrossel | bloqueado pelo Painel |

O **chat é o de maior retorno imediato**: "estamos dentro da meta?" é a pergunta
mais natural que alguém faz, é a que hoje não tem resposta, e não depende de
nenhuma tela nova.

---

## 5 · Anti-padrões

O que **não** fazer, com o motivo:

- **Meta em métrica que o time não controla** (§1.1). Produz número decorativo e
  desmoraliza o resto do painel.
- **Meta sobre número bruto quando o líquido existe.** Meta de inscritos ganhos
  premiaria um canal que ganha 382 e perde 767 — foi o julho real do CPPEM.
- **Meta sobre número arredondado.** A API pública do YouTube devolve 387.000
  parado por semanas; meta sobre isso daria ganho zero para sempre.
- **Semáforo sem período de graça.** Ver §2.1: acumulado sempre nasce vermelho.
- **Copiar metas automaticamente sem alguém confirmar.** A cópia do §2.3 deve ser
  um botão, não um `cron` — meta herdada em silêncio deixa de ser compromisso.
- **Meta como enfeite do Painel.** Se a meta não muda nenhuma decisão, ela está
  ocupando espaço que um número informativo ocuparia melhor.

---

## 6 · Ordem sugerida

| # | Item | Esforço | Depende de |
|---|---|---|---|
| 1 | Régua ao lado do campo (§2.2) | baixo | nada |
| 2 | Taxa vs acumulado + projeção (§2.1) | médio | nada |
| 3 | Copiar do mês anterior (§2.3) | baixo | nada |
| 4 | Setas de mês + resumo no topo (§2.4, §2.5) | baixo | nada |
| 5 | Metas no chat (§4) | baixo | nada |
| 6 | Histórico (§2.6) | médio | nada |
| 7 | Metas de GA4 (§3.1) | baixo | **eventos-chave no GA4** |
| 8 | Metas de qualidade (§3.2) | médio | decidir quais |
| 9 | Meta anual (§2.7) | médio | migration + decisão |

**Comece por 1 e 2.** Os dois primeiros consertam a confiabilidade do que já está
na tela; os seguintes ampliam alcance. Fazer 3 antes de 1 e 2 só multiplicaria
metas mal calibradas.

---

## 7 · Pendências que atravessam tudo

- **A meta de 110.000 precisa ser corrigida ou removida.** Enquanto estiver lá,
  qualquer semáforo que ordene "pior primeiro" vai estrear com ela no topo —
  inclusive o Painel e o Modo TV.
- **Eventos-chave do GA4 não configurados** — bloqueia §3.1 inteiro.
- **Origem da venda não existe no Conta Azul** — bloqueia §3.3.
- **8 dos 11 alvos sem meta.** Nenhuma funcionalidade acima compensa isso; é
  decisão de gestão, não de código.
