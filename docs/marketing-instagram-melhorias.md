# Instagram — defeitos e melhorias

Levantado em 2026-08-11 a pedido do requisitante, depois de ele notar que a aba
"parecia ter mais coisa".

> ✅ **TUDO IMPLEMENTADO em 2026-08-11.** Este documento deixou de ser proposta e
> passou a descrever o que existe. O que foi medido depois da implementação está
> em §5.

Tudo abaixo foi **medido**, não suposto: consultas ao banco e chamadas reais à
Graph API estão citadas com os números que devolveram.

---

## 0 · O que a aba tem hoje

Um componente (`components/instagram-metrics.tsx`) alimentado por quatro
leitores:

| Leitor | Fonte | Janela |
|---|---|---|
| `getInstagramOverview` | `social_daily_insights` + `social_media_insights` | histórico inteiro |
| `getInstagramFunnel` | Graph API **ao vivo** | 28 dias fixos |
| `getInstagramAudience` | `social_audience` | 14 dias fixos |
| `getInstagramStories` | `social_media_insights` (STORY) | 24 h |

Seções renderizadas: KPIs, funil, crescimento de seguidores, seguidores por
marca, melhores posts, desempenho por formato, audiência, stories.

**As quatro fontes têm dado fresco** (verificado 2026-08-11): 290 linhas diárias
até 11/08; audiência do dia 11 com `city` 225, `country` 177, `hour` 120, `age`
35, `gender` 15; 6 stories do Colégio; e o funil respondendo nas 5 contas.

---

## 1 · Defeitos

### 1.1 · A audiência estava truncada em 1.000 linhas 🔴 ✅ CORRIGIDO

`getInstagramAudience` lê 14 dias de `social_audience` **sem `limit`**:

```ts
.from("social_audience")
.select("account_id, breakdown, segment, value, captured_on")
.eq("provider", "instagram")
.gte("captured_on", desde)     // 14 dias
```

A tabela tem **12.632 linhas**. O PostgREST corta em **1.000** por padrão e não
reclama — devolve 200 com o pedaço. O resultado é um recorte silencioso: parte
dos breakdowns some, e alguns segmentos ficam com soma menor do que a real.

É o candidato mais provável ao "havia mais que isso" — some sem erro, sem log e
sem nada na tela dizendo que faltou.

**Correção:** paginar (como `baixasPorParcela` faz no Financeiro) ou reduzir a
janela para o último snapshot por conta, que é o que o leitor já usa depois de
buscar. A segunda é melhor: hoje ele traz 14 dias para usar **um**.

### 1.2 · A aba ignorava o filtro de data 🟡 ✅ CORRIGIDO

Os quatro leitores recebem só a marca:

```ts
getInstagramOverview({ brand })    // histórico inteiro
getInstagramFunnel({ brand })      // 28 dias fixos
getInstagramAudience({ brand })    // 14 dias fixos
getInstagramStories({ brand })     // 24 h
```

O seletor de período fica no topo da tela e **não governa nada aqui**. É o mesmo
defeito corrigido no Meta Ads em 2026-08-11 (`marketing-date-range.tsx` e
`meta-detail.ts`): lá o painel de cima obedecia e o de baixo não.

**Correção:** o encanamento já existe — `resolveRange()` foi exportado de
`dashboard.ts` justamente para isso, e `janelaDoFiltro()` em `meta-detail.ts` é o
modelo a copiar (inclusive o teto de dias para leitura ao vivo).

---

## 2 · Melhorias

### 2.1 · Deltas contra o período anterior ✅ FEITO

Hoje a aba **não tem uma única comparação**. O Meta Ads mostra "▼ 16% vs mês
anterior" em cada número; o Instagram mostra valores soltos.

"54.086 contas engajadas" não diz nada sozinho. Contra o mês passado, vira
informação.

Depende de 1.2 (sem período não há período anterior).

### 2.2 · Alcance diário no gráfico ✅ FEITO

`social_daily_insights` grava **`reach` por dia e por conta** desde sempre. O
gráfico de crescimento desenha **só seguidores**.

O dado está gravado, foi pago em chamada de API, e não aparece em lugar nenhum.
Acrescentar uma segunda série é trabalho de minutos.

> Usar a convenção já adotada no Painel: séries com escala independente, a
> segunda tracejada — a paleta do repo é monocromática (hue 142.5), então cor
> sozinha não separa.

### 2.3 · Meta na tela ✅ FEITO

A aba Metas tem `seguidores_ig` por perfil, com meta, atual, desvio, régua e
ritmo (implementados em 2026-08-11). O painel do Instagram **não sabe que isso
existe**.

Mostrar o progresso da meta ao lado dos seguidores de cada marca fecha o ciclo:
hoje é preciso trocar de aba para saber se o número é bom.

### 2.4 · Engajamento como série ✅ FEITO

Existe como número único do período. Como série, responde "estamos melhorando?".
Os dados por post já estão em `social_media_insights` com `posted_at`.

### 2.5 · Histórico de stories ✅ FEITO

Stories somem em 24 h, e o cron de 6/6 h captura cada um algumas vezes antes de
expirar. Hoje a tela mostra só as últimas 24 h — o histórico já capturado fica
sem uso.

Um "stories dos últimos 30 dias" usa dado que já está gravado.

### 2.6 · ~~Ganhos × perdas de seguidores~~ ❌ TESTADO, NÃO DÁ

A ideia era mostrar bruto em vez de líquido — ganhar 900 e perder 800 aparece
hoje como "+100 tranquilo". Foi o que expôs o canal do YouTube encolhendo
(+382 / −767 em julho).

**Testei ao vivo na conta do CPPEM Concursos e a API não entrega isso.**

| Métrica | 10/08 | Conclusão |
|---|---|---|
| `follower_count` | 151 | ganho **líquido** do dia |
| `follows_and_unfollows` · `FOLLOWER` | **151** | **idêntico** ao líquido |
| `follows_and_unfollows` · `NON_FOLLOWER` | 91 | outra coisa, não unfollows |

`FOLLOWER` repete exatamente o `follower_count`. Se fosse ganho bruto, seria
maior que o líquido — e a diferença seriam os unfollows. Não é.

Confirmado também no mês: `follower_count` somou 1.040 de 01 a 11/08, o mesmo
1.040 que o nosso banco calcula como líquido.

**Fica registrado como testado e descartado**, para ninguém gastar o mesmo tempo
de novo. Se a Meta expuser `follows` e `unfollows` separados numa versão futura,
vale reabrir.

> **O que NÃO é problema:** o total de seguidores está correto. O sync ancora no
> `followers_count` real do nó da conta e reconstrói a série para trás
> (`instagram.ts`). Não há acúmulo de erro.

---

## 3 · Ordem sugerida

| # | Item | Esforço | Depende |
|---|---|---|---|
| 1 | **Corrigir o truncamento da audiência** (1.1) | baixo | nada |
| 2 | **Seguir o filtro de data** (1.2) | baixo | nada |
| 3 | Alcance diário no gráfico (2.2) | baixo | nada |
| 4 | Deltas vs período anterior (2.1) | baixo | item 2 |
| 5 | Meta na tela (2.3) | baixo | nada |
| 6 | Engajamento como série (2.4) | médio | item 2 |
| 7 | Histórico de stories (2.5) | médio | nada |
| — | ~~Ganhos × perdas~~ | — | **descartado** (2.6) |

**Comece por 1 e 2**: são correção, não funcionalidade nova. O item 1 pode ser
exatamente o que o requisitante notou faltando.

---

## 4 · Achado colateral

Investigando esta aba, apareceu um problema de **outra**: `meta-detail` estourou
o timeout de 12 s e degradou 5 vezes nas últimas 24 h.

Ele leva **50–60 s a frio** (medido no aquecimento de cache de 2026-08-11), então
a aba Meta Ads perdia o painel de detalhe sempre que o cache esfriava — sem aviso
na tela, só um `null`.

O aquecimento por cron (`marketing-fase4.md` §C) resolve o caso comum. Mas o teto
de 12 s continua curto para uma chamada fria de verdade: vale subir `T_LENTO`
para esse caso específico, ou aceitar que fora do cache o painel não aparece.


---

## 5 · O que foi construído, e o que a medição mostrou

Implementado em 2026-08-11. Arquivos tocados: `lib/marketing/social.ts`,
`lib/marketing/instagram-funnel.ts`, `components/instagram-metrics.tsx`,
`app/(app)/marketing/page.tsx`.

### 5.1 · O truncamento era pior do que parecia

Medido na mesma janela que o leitor usava (14 dias):

| | Linhas | Breakdowns |
|---|---|---|
| Sem paginação (como era) | **1.000** | city 343 · country 387 · hour 224 · age 41 · **gender 5** |
| Com paginação (agora) | **8.621** | city 3.414 · country 2.748 · hour 1.749 · age 492 · **gender 218** |

**A tela não via 7.621 linhas** — 88% do dado. O `gender` aparecia com 5 linhas
de 218: um gráfico de gênero desenhado sobre 2% da amostra, sem nada indicando
que faltava.

### 5.2 · As peças novas

**Janela comum.** `JanelaIg` + `periodoIg()` em `social.ts`, usando o
`resolveRange()` do `dashboard.ts` — a mesma função do Meta Ads, para as duas
abas nunca discordarem sobre o período exibido. Os quatro leitores passaram a
aceitá-la.

**`lerTudo()`.** Paginação de 1.000 em 1.000 com ordem estável (obrigatória: sem
ela o PostgREST pode repetir ou pular linhas entre páginas) e teto de 50 páginas.
Aplicada à audiência, aos posts e aos stories.

**Deltas.** `IgAnterior` traz os agregados do período anterior de igual duração.
Cuidado que a implementação precisou tomar: o delta de seguidores é sobre o
**ganho no período**, não sobre o total — comparar totais daria sempre "+0,1%".
E o `anterior.reach` soma alcance de POST, não da conta: `social_daily_insights.reach`
é o alcance da conta no dia, outra métrica, e comparar um com o outro produziria
um delta sem significado.

**Séries novas.** O gráfico ganhou `reach` (que já era gravado e nunca aparecia)
e `engagement` (dos posts do dia). Três séries com escala independente e
distinção por FORMA além de cor — área, tracejado e linha cheia —, porque a
paleta do repo é monocromática.

**Meta na tela.** As metas de `seguidores_ig` chegam ao painel e aparecem sob a
barra de cada marca. Somadas por marca, porque a meta é por PERFIL e o card
mostra a marca — o "Everton" tem dois perfis.

**Stories por período.** Antes só as últimas 24h; agora o período do filtro. Os
agregados usam TODOS os stories da janela e o `limit` corta só a lista exibida —
antes o teto limitava a própria consulta e o total ficava preso nele.

### 5.3 · Ganho medido

| Métrica | Antes | Depois |
|---|---|---|
| Linhas de audiência lidas | 1.000 | **8.621** |
| Stories no período | 93 (24h) | **556** |
| Séries no gráfico | 1 | **3** |
| Comparações na aba | **0** | 4 KPIs com delta |

O alcance diário, que nunca aparecia, varia de 44.395 a 218.489 em uma semana —
é informação que estava sendo paga em chamada de API e descartada.
