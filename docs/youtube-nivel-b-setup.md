# YouTube Nível B (OAuth do dono do canal) — **entregue**

O Nível A usa a service account e dá **dados públicos**: inscritos arredondados,
views, vídeos, likes. O **Nível B** usa a *YouTube Analytics API* com autorização
do dono e destrava o que a leitura pública não enxerga.

Escrito em 2026-07-21 como guia de setup. Reescrito em 2026-08-05, depois da
implementação, porque **três premissas do guia original estavam erradas** e
custaram horas — estão marcadas ⚠️ abaixo.

---

## Por que isto importa: o caso CPPEM

A leitura pública mostrava **387.000 inscritos, parados havia semanas**. Com a
Analytics API, julho de 2026 no mesmo canal:

| | Ganhos | Perdidos | **Líquido** |
|---|---:|---:|---:|
| CPPEM Concursos | 382 | 767 | **−385** |
| Colégio Cppem | 43 | 34 | **+9** |

O canal **encolheu 385 inscritos** e o painel dizia que estava estável. O
arredondamento para 3 dígitos significativos (que a API aplica **inclusive para o
dono**) engolia qualquer variação abaixo de mil.

Era exatamente por isso que a meta de inscritos do YouTube tinha ficado de fora:
não dá para cobrar meta sobre um número que nunca se move.

---

## ⚠️ Erro 1 — "cada canal precisa da sua própria autorização"

**O guia original afirmava isso. É falso.** Uma autorização cobre **todos** os
canais que a conta administra.

A Analytics API recebe o canal como **parâmetro** (`ids=channel==UC...`), não
embutido no token. O único requisito é que a conta autorizada administre aquele
canal. Testado: o token obtido pelo Colégio lê o CPPEM Concursos sem reclamar.

**O custo do erro.** Como o CPPEM e o Everton são **contas de marca**, o Google
nunca os oferece no seletor da tela de consentimento — então "conectar cada canal"
era **impossível de cumprir**. Foram gastas horas revogando acesso, alternando o
público-alvo entre Interno e Externo e tentando em janela anônima, atrás de um
seletor que não precisava existir.

**Como eu deveria ter verificado, em 1 minuto:** com o primeiro token na mão,
consultar o segundo canal e ver se responde. Foi o que resolveu no fim.

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==<OUTRO_CANAL>\
&startDate=2026-07-01&endDate=2026-07-31&metrics=views,subscribersGained"
```

Responde 200 com linhas → o token cobre o canal. Não precisa de mais nada.

---

## ⚠️ Erro 2 — receita vem em USD, não em reais

`estimatedRevenue` **sem o parâmetro `currency` responde em dólar.** Julho do
CPPEM voltava `24.621`.

Formatado como real, viraria **"R$ 24,62"**. O valor verdadeiro é **R$ 125,86** —
erro de 5x, e plausível o bastante para nunca ser questionado.

```text
(sem parâmetro)  [[24.621]]     ← USD
currency=BRL     [[125.858]]    ← o certo
currency=USD     [[24.621]]
```

O leitor passa `currency: "BRL"` na consulta de receita. **Toda métrica monetária
da Analytics API precisa desse parâmetro.**

De quebra: o guia dizia que os canais não eram monetizados. O **CPPEM é** —
R$ 125,86 em julho. Quem não é monetizado é o Colégio (devolve `rows: []`, que o
código trata como `null`, e não como "R$ 0,00" — são afirmações diferentes).

---

## ⚠️ Erro 3 — a hipótese do "Interno bloqueia conta de marca"

Levantada para explicar o seletor ausente, e **também falsa**: o usuário trocou
para Externo e nada mudou. O seletor não aparecia porque contas de marca não são
oferecidas ali, ponto — independente do público-alvo.

**O público-alvo correto é `Interno`** (o projeto pertence ao Workspace do
`cppem.com.br`): sem verificação do Google e **sem expiração do refresh token**.
Externo em modo Teste faria o refresh morrer a cada 7 dias sem necessidade.

---

## Como está montado

| Arquivo | Papel |
|---|---|
| `lib/marketing/youtube-oauth.ts` | URL de consentimento, troca de código, renovação de token |
| `lib/marketing/youtube-analytics.ts` | consultas à Analytics API por canal e competência |
| `app/api/youtube/connect` · `callback` · `conexoes` | fluxo OAuth e desconexão |
| `components/youtube-conexoes.tsx` | faixa de conexão (a **conta**, e os canais que ela cobre) |
| `components/youtube-analytics-panel.tsx` | cards de líquido, views, exibição, retenção, receita |
| `supabase/migrations/0037_youtube_connections.sql` | tabela de conexões |

**Credenciais:** `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, do projeto
`jarvis-498903`. O prefixo numérico do client id **é o número do projeto** — se
não bater com `202356383682`, é credencial de outro projeto e o Google responde
`deleted_client` ou `invalid_client`. (Aconteceu: a chave em uso era do projeto
`29493631405`. Bastava comparar o prefixo.)

**Escopos:** `yt-analytics.readonly`, `yt-analytics-monetary.readonly` (receita) e
`youtube.readonly` (descobrir o canal no callback).

**Redirect:** precisa bater exatamente com o cadastrado no console. O Google
recusa IP puro — só domínio público ou `localhost`.

---

## Operação

**Conectar:** aba YouTube → *Conectar conta do Google* → autorizar com
`administrador@cppem.com.br`. Uma vez só, e cobre os dois canais.

**Se o acesso for revogado** em `myaccount.google.com`, a renovação falha com
`invalid_grant`. O `tokenValido()` apaga a linha sozinho, a faixa volta a dizer
"nenhuma conta conectada" e basta reconectar — em vez de a tela seguir dizendo
"conectado" enquanto toda leitura falha.

**Se a Analytics cair,** as linhas de inscritos ficam sem `atual` e as outras 9
metas seguem intactas: a chamada é a única fonte externa da tela de metas e está
isolada em `.catch()`.

---

## O que o painel mostra

Um canal por vez (seletor), em janelas de **7 / 28 / 90 / 365 dias** — padrão 28,
a mesma do YouTube Studio. Estado na URL (`ytCanal`, `ytDias`), então o link é
compartilhável.

| Bloco | Origem |
|---|---|
| KPIs: líquido de inscritos, views, exibição, retenção, engajamento, receita | métricas agregadas |
| Dia a dia (gráfico) | `dimensions=day` |
| Shorts × Vídeos × Lives | `dimensions=creatorContentType` |
| Mais vistos (top 10, com miniatura) | `dimensions=video` + Data API pelos títulos |
| De onde vêm as views | `dimensions=insightTrafficSourceType` |
| O que pesquisaram | `insightTrafficSourceDetail` filtrado em `YT_SEARCH` |
| Idade e gênero | `dimensions=ageGroup,gender` |
| Dispositivo · País · Inscrito × não inscrito | `deviceType`, `country`, `subscribedStatus` |

São ~12 consultas por canal, **em paralelo** — em série estourariam o timeout da
página (`T_YOUTUBE`, 20s). Cada consulta degrada sozinha para lista vazia: uma
dimensão indisponível apaga a seção dela e não derruba as outras onze.

> **A série diária termina ~2 dias antes de hoje.** Não vem baixa — vem *ausente*:
> o YouTube ainda não consolidou. Numa janela de 28 dias voltam 26 linhas.

**Por que janela em dias e não competência.** A primeira versão usava o mês
corrente e, no dia 5, mostrava 5 dias — gráfico vazio e KPIs sem sentido. A meta
continua por competência (é mensal por natureza); o painel de acompanhamento, não.

---

## O que ainda ficou de fora

- **Impressões e CTR** — não existem na API, só no Studio. `impressions` responde
  `Unknown identifier`.
- **Retenção relativa por trecho do vídeo** (`audienceWatchRatio`) — exige
  consulta por vídeo, uma a uma.
- **Catálogo inteiro de vídeos** — o Nível A ainda lista só os 25 mais recentes.
  O top 10 do painel novo já vem da Analytics e cobre qualquer vídeo do período.
- **Cache/sync** — a leitura é ao vivo a cada carregamento. Se pesar, entra no
  cron de 6/6h junto com o resto do marketing.
