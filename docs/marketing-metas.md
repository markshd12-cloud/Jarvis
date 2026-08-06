# Metas no Marketing — levantamento

Estudo de viabilidade das metas pedidas para o painel de Marketing, com os
números medidos em **2026-08-04**. Documento de decisão: registra o que já dá
para fazer, o que está bloqueado e por quê, e as escolhas de modelagem que ainda
dependem do requisitante.

Nada foi implementado ainda.

---

## As cinco metas pedidas

| Meta | Estado | Fonte |
|---|---|---|
| CPL (custo por lead) | ✅ viável | `marketing_daily_insights`, por marca |
| CAC | ✅ viável | `getCac()` (`lib/marketing/cac.ts`), por BU |
| Seguidores Instagram | ✅ viável | `social_daily_insights`, snapshot diário |
| Seguidores YouTube | ✅ **em produção** | `youtube-analytics.ts`, 2 canais (OAuth do dono) |
| **Receita do YouTube** | ⏸️ dado existe, meta não cadastrável | `estimatedRevenue`, só 1 canal monetizado |

### Seguidores do YouTube — resolvido em 2026-08-05

Ficou fora do primeiro lote por um motivo real: a Data API **arredonda inscritos
para 3 dígitos significativos acima de 1.000, inclusive para o dono do canal**. O
CPPEM marcava 387.000 imóvel, e "ganho no mês" daria sempre zero.

Com a Analytics API (nível B, OAuth), julho aparece como **382 ganhos e 767
perdidos — líquido de −385**. O canal encolhia e o painel dizia que estava
estável.

A meta usa o **líquido**, mesma leitura do Instagram: perder 767 e ganhar 382 não
é crescimento, e uma meta sobre o bruto premiaria um canal que sangra.

### Receita do YouTube — o dado destravou, a meta não

O nível B trouxe `estimatedRevenue`, e o CPPEM **é monetizado**: R$ 125,86 em
julho. O Colégio não é (a API devolve `rows: []`).

Não virou meta porque um único canal com receita de dois dígitos não sustenta um
alvo mensal — cadastrar geraria uma linha que ninguém acompanha. O número aparece
no card do canal, e a meta entra se e quando a receita virar volume relevante.

> Cuidado ao mexer: `estimatedRevenue` **responde em USD sem o parâmetro
> `currency`**. Ver o Erro 2 em `youtube-nivel-b-setup.md`.

---

## A descoberta que muda o desenho: Colégio não gera lead **por design**

A suspeita inicial era rastreamento quebrado (R$ 9.666 investidos, 0 leads). O
histórico completo mostra outra coisa:

```
marca              dias   investido      leads  conversas  compras
CPPEM Concursos      47  R$ 13.304,12    1295        965       52
Colégio              25   R$ 9.666,59       0        335        0
Unicive              51   R$ 7.550,67     283       1526        5
Everton              32     R$ 839,67       8         41        0
```

O Colégio registrou conversa em **23 dos 25 dias** com investimento. A campanha é
otimizada para **conversa de WhatsApp**, não para lead. Não há nada a consertar.

E isso não é exceção do Colégio: **as quatro marcas geram conversa**, e na Unicive
as conversas superam os leads em cinco vezes.

### Custo por resultado, por marca

| Marca | Investido | CPL | Custo/conversa |
|---|---|---|---|
| CPPEM Concursos | R$ 13.304,12 | R$ 10,27 | R$ 13,79 |
| Unicive | R$ 7.550,67 | R$ 26,68 | R$ 4,95 |
| Colégio | R$ 9.666,59 | — | **R$ 28,86** |
| Everton | R$ 839,67 | R$ 104,96 | R$ 20,48 |

**Proposta:** tratar como uma única **"meta de custo por resultado"**, em que cada
marca declara qual resultado conta (lead ou conversa). Assim o Colégio deixa de
ser um buraco na tela e a Unicive passa a ser medida pelo que de fato produz.

A alternativa — manter CPL e custo/conversa como metas separadas, com o CPL do
Colégio vazio — também funciona, mas perde a leitura de eficiência dele.

---

## Três decisões de modelagem

### 1 · Direção: teto × piso

CAC e CPL são **"quanto menor melhor"** → a meta é um **teto**.
Seguidores e receita são **"quanto maior melhor"** → a meta é um **piso**.

Sem isso explícito no modelo, o indicador de desvio pinta verde onde devia pintar
vermelho. É o mesmo cuidado que o DRE já toma com a convenção de sinal (receita
+, despesa −), onde "positivo = melhor que o planejado" vale para os dois lados.

**Consequência:** a tabela de metas precisa de uma coluna `direcao` (`max`/`min`),
e o cálculo do desvio precisa lê-la — não dá para inferir pela métrica.

### 2 · Fluxo × estoque

- **Fluxo** (CAC, CPL, custo/conversa, receita): meta **por competência**, como o
  Orçamento do Financeiro. "CPL de agosto ≤ R$ 8,00".
- **Estoque** (seguidores): é saldo acumulado. A meta natural tem **data-alvo** —
  "100k seguidores até 31/12" — e não competência.

São dois tipos de meta na mesma tela. A alternativa é converter seguidores em
fluxo (**ganho no mês**: "+2.000 seguidores em agosto"), o que uniformiza tudo
por competência e simplifica a tela. **Em aberto.**

### 3 · Granularidade

| Métrica | Chave |
|---|---|
| CPL / custo por conversa | marca do Meta (4) |
| CAC | BU (3) |
| Seguidores IG | conta (5 perfis) |
| Seguidores YouTube | canal (2) |

**Armadilha:** a marca **"Everton" tem DUAS contas de Instagram** — 103.426 e 5.343
seguidores. A meta é da marca somada ou de cada perfil? **Em aberto.**

---

## Decisões já fechadas

- **YouTube:** só CPPEM Concursos e Colégio. Unicive e Everton não têm canal
  (`youtube: null` no config) e **não devem aparecer**. Já é o comportamento
  atual — `getYoutubeOverview` filtra por `b.youtube &&` ([youtube.ts:38](../lib/marketing/youtube.ts#L38)),
  então as marcas sem canal nunca entram na lista. Nada a fazer.
- **Colégio:** medido por **conversa**, não por lead.

---

## Modelagem proposta

Tabela nova `mkt_metas` (nome a confirmar), aditiva:

```
id, metrica      -- cpl | custo_conversa | cac | seguidores_ig | seguidores_yt | receita_yt
    alvo         -- brand / bu / account_id; null = consolidado
    competencia  -- 'AAAA-MM' para metas de FLUXO
    data_alvo    -- date, para metas de ESTOQUE (se mantivermos os dois tipos)
    valor        -- numeric
    direcao      -- 'max' (teto) | 'min' (piso)
    ativo, created_at, updated_at
```

Único por (`metrica`, `alvo`, `competencia`/`data_alvo`), com `coalesce` no alvo
nulo — mesmo padrão do índice de `fin_orcamentos`, que já resolveu esse caso.

**Lição do Financeiro a não repetir:** a rota de meta do DRE gravava `bu_id: null`
fixo enquanto a leitura filtrava pela BU aberta — a meta ia para uma gaveta e era
procurada em outra, e voltava zerada. Aqui, **quem grava e quem lê têm de usar o
mesmo `alvo`**.

---

## Estado dos dados (2026-08-04)

```
Meta Ads      208 dias-marca | 13/06 a 04/08 | R$ 31.361 | 1.586 leads | 2.867 conversas
Instagram     283 dias, 7 contas | 15/06 a 04/08
Posts         955 (IG 809 + YouTube 146)
GA4           ao vivo, sem tabela (cache 28d)

Seguidores (último snapshot, 04/08)
  instagram  CPPEM Concursos   92.943
  instagram  Everton          103.426  +  5.343  (duas contas)
  instagram  Colégio           17.344
  instagram  Unicive           12.051
  youtube    CPPEM Concursos  387.000
  youtube    Colégio            4.870
```

Sync roda de 6/6h pelo cron da VPS (`jarvis-cron.sh marketing`).

---

## Pendências

- **Passo 8 (YouTube nível B)** — pré-requisito da meta de receita. Falta o ID do
  cliente OAuth, travado na tela de consentimento do Google.
- **Colégio sem investir desde 07/07/2026** — os últimos dias registram R$ 0,00.
  Não impede a meta, mas explica a série truncada no painel.
- **Unicive e Everton sem canal de YouTube** — se um dia tiverem, basta preencher
  o handle em `lib/marketing/config.ts`.
