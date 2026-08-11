# Marketing — Fase 4: Contexto no chat, Metas e cache quente

Arquitetura escrita em 2026-08-11, a pedido do requisitante, **para validação
antes de implementar**. Nada aqui foi construído.

Cobre três frentes independentes:

| # | Frente | Esforço | Depende de |
|---|---|---|---|
| A | Contexto no chat | médio | nada |
| B | Metas — 8 melhorias | médio | 1 migration (só a última) |
| C | Cron aquece cache | baixo | nada |

Ficou **de fora**: metas de GA4 (§3.1 do `marketing-metas-plano.md`), bloqueada
até existirem eventos-chave configurados.

---

# A · Contexto no chat

## A.1 · O que existe hoje

`lib/ai/marketing-context.ts`, 251 linhas, uma função pública:
`buildMarketingBlock(pergunta)`.

```
pergunta
   │
   ├─ isMarketingQuery()  ← UM regex decide tudo
   │
   └─ buildMarketingBlock()
        ├─ Meta Ads · diário 35d + mês corrente + período citado   ✅
        └─ YouTube  · getYoutubeOverview() (número PÚBLICO)        ⚠️
```

| Fonte | Cobertura |
|---|---|
| Meta Ads | ✅ completa |
| YouTube | ⚠️ público — arredondado, **mostra número errado** |
| Metas · CAC · GA4 · Instagram | ❌ nada |

Duas falhas estruturais, não de cobertura:

1. **Tudo ou nada.** Um único `MARKETING_RE` decide se o bloco entra, e quando
   entra vem inteiro. Pergunta sobre inscritos carrega a tabela diária de 35
   dias do Meta Ads junto.
2. **O YouTube mente.** `getYoutubeOverview` lê a API pública, que arredonda para
   3 dígitos significativos acima de 1.000. O CPPEM marca "387.000" há semanas; o
   real de julho foi **−385**. O chat repete o número arredondado.

## A.2 · Arquitetura proposta — blocos com gatilho próprio

O orquestrador para de perguntar "é marketing?" e passa a perguntar **"quais
blocos esta pergunta pede?"**.

```
pergunta ──► seletor ──► [blocos elegíveis] ──► montagem paralela ──► prompt
                │                                      │
                │  gatilho por bloco                   │  cada um degrada
                │  (regex própria)                     │  sozinho
                ▼                                      ▼
        "estamos na meta?"  → metas                 falha → bloco some,
        "quanto gastamos?"  → meta-ads                      resto continua
        "o site teve visita?" → ga4
```

### Interface

```ts
// lib/ai/marketing-blocos/tipos.ts
export interface BlocoContexto {
  chave: string;
  /** Decide se ESTE bloco entra. A união de todos substitui MARKETING_RE. */
  gatilho: RegExp;
  /** 'leve' = lê nosso banco. 'pesado' = API externa (entra por último). */
  peso: "leve" | "pesado";
  montar(ctx: { pergunta: string; periodo: Periodo | null }): Promise<string>;
}
```

### Arquivos

```
lib/ai/marketing-context.ts          orquestrador (seleção, orçamento, montagem)
lib/ai/marketing-blocos/
  ├── tipos.ts                       BlocoContexto + helpers de formatação
  ├── meta-ads.ts                    extraído do arquivo atual (sem mudança)
  ├── youtube.ts                     TROCA público → nível B
  ├── metas.ts                       novo
  ├── cac.ts                         novo
  ├── ga4.ts                         novo
  └── instagram.ts                   novo
```

Hoje o arquivo tem 251 linhas; com seis blocos passaria de 600 num arquivo só.
A quebra é pelo tamanho, não por gosto.

## A.3 · Os blocos, em ordem de valor

### A.3.1 · Metas — o de maior retorno

*"Estamos dentro da meta?"* é a pergunta mais natural do chat e a única que hoje
não tem resposta nenhuma.

`getMetasComAtual(competencia)` já devolve alvo, atual e desvio prontos. O bloco
é formatação:

```
## Metas de Marketing — agosto/2026 (3 de 11 definidas)
Meta é TETO para custo (menor é melhor) e PISO para seguidores (maior é melhor).

| Alvo | Meta | Atual | Desvio |
|---|---|---|---|
| Custo por lead · Unicive | R$ 7,00 | R$ 7,85 | −R$ 0,85 (pior) |
| Custo por lead · CPPEM   | R$ 8,00 | R$ 10,76 | −R$ 2,76 (pior) |

8 alvos ainda SEM meta cadastrada — não confunda "sem meta" com "meta zero".
```

Gatilho: `/meta|objetivo|alvo|dentro d|bat(er|emos)|previsto/i`

> ⚠️ Precisa avisar sobre metas não cadastradas. Sem isso o modelo responde
> "estamos dentro das metas" olhando 3 de 11.

### A.3.2 · YouTube nível B — trocar, não acrescentar

Substitui o bloco público pelo real: ganho **líquido** de inscritos, watch time,
retenção, por canal, via `analyticsPorCompetencia()`.

> ⚠️ Isto CORRIGE uma resposta errada que o chat dá hoje. Prioridade alta apesar
> do esforço baixo.

### A.3.3 · CAC

`getCac()` com o corte de fonte (Conta Azul até jul/2026, banco próprio depois),
que o modelo precisa saber para não comparar períodos indevidamente.

> ⚠️ Incluir que o **realizado depende de baixas lançadas**. Sem esse aviso o
> modelo afirma que o custo caiu a zero.

### A.3.4 · GA4

Sessões, usuários, canais de aquisição, páginas de entrada.

> ⚠️ **Hoje o bloco não deve entrar.** A propriedade não coleta desde 29/07 (ver
> `ga4-sgtm-diagnostico.md`). Um bloco "0 sessões" faz o modelo afirmar que o
> site não teve visita. Regra: `sessions > 0` ou o bloco não é montado.

### A.3.5 · Instagram orgânico

Seguidores por perfil, alcance, engajamento e o funil. Responde "o Instagram
está crescendo?", que é pergunta diferente de "quanto gastamos".

## A.4 · Controle de tamanho

Seis blocos a cada pergunta inflam o prompt, custam latência e diluem a atenção
do modelo. Duas travas:

| Trava | Regra |
|---|---|
| **Seleção** | só entram os blocos cujo gatilho casou |
| **Orçamento** | teto de caracteres; leves primeiro, pesados até caber |

Pergunta genérica ("como está o marketing?") casa com vários gatilhos — nesse
caso entra a **versão curta** de cada bloco (só os totais), não a tabela diária.

## A.5 · Ordem sugerida

| # | Bloco | Por quê |
|---|---|---|
| 1 | Metas | maior retorno, dado já pronto |
| 2 | YouTube nível B | corrige resposta errada |
| 3 | Refatorar para o seletor | antes que sejam 6 blocos |
| 4 | CAC | pergunta frequente |
| 5 | Instagram | completa o orgânico |
| 6 | GA4 | **só depois de religar a coleta** |

Os dois primeiros cabem no arquivo atual sem refatoração. A partir do terceiro,
o seletor compensa.

---

# B · Metas — as 8 melhorias

Detalhe do "porquê" de cada uma em `marketing-metas-plano.md`. Aqui é o **como**.

## B.1 · O conceito que sustenta metade delas

Hoje `AlvoMeta` não sabe que tipo de métrica ele é. Precisa saber:

```ts
// lib/marketing/metas.ts
export type TipoMetrica = "taxa" | "acumulado";
```

| Tipo | Métricas | Comparável no meio do mês? |
|---|---|---|
| `taxa` | custo por resultado | **Sim** — R$ 7,85/lead é R$ 7,85 no dia 5 ou no 30 |
| `acumulado` | seguidores, inscritos | **Não** — 11 dias contra a meta do mês inteiro |

Esse campo destrava os itens 1, 2 e 6. É a primeira coisa a fazer.

## B.2 · Item 1 · Régua ao lado do campo

**Problema:** a meta de 110.000 seguidores. Quem digitou queria "chegar a 110
mil"; a tela entendeu "ganhar 110 mil neste mês".

**Solução:** `MetaComAtual` ganha `baseline`:

```ts
baseline?: {
  /** Total de hoje (93.175 seguidores) — só para acumulados. */
  atualAbsoluto: number;
  /** Média de ganho dos últimos 3 meses (1.180/mês). */
  mediaHistorica: number | null;
}
```

Na tela, abaixo do rótulo:
```
CPPEM Concursos · @cppemconcursos
hoje 93.175 seguidores · ganho médio 3 meses: 1.180/mês
meta de ganho [        ]
```

**Complemento:** aviso ao digitar acima de ~10× a média — *"essa meta é 93× o
ganho médio; você quis dizer o total de seguidores?"*. **Aviso, não bloqueio:**
meta ambiciosa existe, e a tela não decide pelo gestor.

## B.3 · Item 2 · Taxa vs acumulado + projeção

Para `acumulado`, comparar contra a meta **proporcional aos dias decorridos**:

```
Seguidores · CPPEM Concursos
meta 2.000 no mês  ·  esperado até hoje 710  ·  atual 1.040  ·  +330 no ritmo
projeção do mês 2.930                                          ▲ 46% acima
```

Três detalhes que a implementação precisa acertar:

| Detalhe | Regra |
|---|---|
| Só o mês corrente projeta | mês fechado compara direto |
| Denominador = **última coleta**, não hoje | IG é snapshot diário; YouTube atrasa ~2d |
| Ritmo linear é aproximação | a tela precisa dizer isso |

Sem isto, **toda meta acumulada nasce vermelha no dia 1º** e vai esverdeando —
o que treina as pessoas a ignorar a cor por três semanas.

## B.4 · Item 3 · Copiar do mês anterior

Onze alvos, três preenchidos. É o item de maior efeito sobre **adoção**: os
outros melhoram metas que existem; este faz metas existirem.

```
POST /api/marketing/metas/copiar   { de: "2026-07", para: "2026-08", fator?: 1.1 }
```

Regra: preenche **só o que está vazio**, nunca sobrescreve o que já foi digitado.

Botão, não `cron` — meta herdada em silêncio deixa de ser compromisso.

## B.5 · Item 4 · Setas de mês + resumo no topo

Setas `‹ mês ›` como em Contas a Pagar, Recorrências e Colaboradores; o
`<select>` fica ao lado para saltos longos.

Resumo em uma linha, antes dos blocos:
```
3 de 11 definidas · 2 dentro · 1 fora · 8 sem meta      [ só as que estão fora ]
```

O filtro "só as que estão fora" é a visão de reunião de acompanhamento.

> O Painel já tem o seletor de mês pelo mesmo `?comp`. Aqui é aplicar o mesmo
> componente.

## B.6 · Item 5 · Metas no chat

É o **A.3.1**. Aparece nas duas listas porque atende às duas — implementar uma
vez.

## B.7 · Item 6 · Histórico

Coluna com os últimos 3–6 meses por alvo. Transforma a tela de fotografia em
série: distingue *"estamos ruins"* de *"estamos piorando"*.

**A decisão de arquitetura aqui é o custo.** Recalcular `atual` de 6 meses × 11
alvos significa refazer as somas do Meta, a série do Instagram e — o caro — as
consultas da Analytics do YouTube.

| Opção | Prós | Contras |
|---|---|---|
| Recalcular ao abrir | sempre correto | lento; bate na API do YouTube 6× |
| **Cachear por (métrica, alvo, competência)** | mês fechado nunca muda → TTL longo | precisa invalidar o mês corrente |
| Materializar em tabela | mais rápido | migration + backfill + risco de divergir |

**Recomendo cachear** em `cache_kv`, com TTL longo para mês fechado e curto para
o corrente. Sem migration, e o mês fechado é imutável por definição.

## B.8 · Item 8 · Metas de qualidade

Todas as metas de hoje contam **quantidade**. Faltam as que medem se a
quantidade presta:

| Canal | Métrica | Direção |
|---|---|---|
| Instagram | taxa de engajamento | piso |
| YouTube | retenção média | piso |
| Meta Ads | CTR | piso |
| Meta Ads | frequência | **teto** |

Frequência merece destaque: é o **sinal antecedente** de custo por lead subindo.
Meta de teto nela cobra antes do estrago — e o estrago é exatamente o que
aconteceu em agosto (+181% no CPPEM).

Nenhuma exige integração nova. Todas já são lidas e cacheadas.

## B.9 · Item 9 · Meta anual

*"Quero 110 mil seguidores até dezembro"* é o pedido real. A tela força traduzir
para ganho mensal, de cabeça, todo mês — e foi assim que nasceu o erro dos
110.000.

**Única frente com migration:**

```sql
-- supabase/migrations/00XX_mkt_metas_anual.sql
alter table mkt_metas add column horizonte text default 'mensal';  -- 'mensal' | 'anual'
alter table mkt_metas add column ano int;  -- preenchido quando horizonte='anual'
```

**Decisão de produto em aberto:** quando um mês fura, o sistema redistribui o que
falta nos meses restantes (mais agressivo) ou mantém o plano original (mais
honesto)? Isso muda o comportamento e não é escolha técnica.

Por isso este é o **último** item: exige migration e uma decisão de gestão.

## B.10 · Ordem

```
B.1 tipo taxa/acumulado   ◄── destrava 1, 2 e 6
  │
  ├─► 1 régua        (evita erro de digitação)
  ├─► 2 projeção     (evita leitura errada da cor)
  ├─► 3 copiar       (faz metas existirem)
  ├─► 4 setas+resumo (atrito)
  ├─► 5 chat         = A.3.1
  ├─► 6 histórico    (precisa da decisão de cache)
  ├─► 8 qualidade    (decidir quais)
  └─► 9 anual        (migration + decisão de gestão)
```

**Comece por B.1 + itens 1 e 2.** Fazer o 3 antes só multiplicaria metas mal
calibradas.

---

# C · Cron aquece cache

## C.1 · O problema, e por que não é o óbvio

Hoje o cron chama `POST /api/marketing/sync`, que roda `syncMeta`,
`syncInstagram` e `syncYoutube` — **escritas** no nosso banco.

Nada aquece os caches de **leitura**. A primeira visita do dia paga o custo cheio
de cada integração ao vivo:

| Leitor | Fonte | TTL |
|---|---|---|
| `getMetaDetail` | Graph API | 10 min |
| `getMetaBreakdowns` | Graph API | 10 min |
| `getGa4Overview` | GA4 Data API | 10 min |
| `analyticsPorCompetencia` | YouTube Analytics | 30 min |
| `detalheDoCanal` | YouTube Analytics (11 consultas) | 30 min |
| `getCac` | Conta Azul / banco | — |
| `getPainelMarketing` | **todas** | — |

## C.2 · A armadilha: aquecer sozinho não resolve

```
cron 6/6h  ──►  aquece  ──►  cache quente
                                  │
                             10 min depois
                                  ▼
                              FRIO de novo
```

TTL de 10 minutos contra cron de 6 horas: o cache passa **97% do tempo frio**.
Aquecer sem mexer no TTL é gastar chamada de API para nada.

## C.3 · Arquitetura — TTL longo + cron como atualizador

Inverter o papel. O TTL deixa de ser "de quanto em quanto tempo recalcular" e
passa a ser "quanto tempo o dado pode envelhecer"; quem recalcula é o cron.

```
        ANTES                          DEPOIS
   TTL 10min, sem cron            TTL 6h, cron de 3/3h
   ──────────────────             ────────────────────
   usuário paga o cálculo         cron paga o cálculo
   frio quase sempre              sempre quente
```

| Leitor | TTL hoje | TTL proposto | Por quê |
|---|---|---|---|
| `getMetaDetail` / breakdowns | 10 min | **6 h** | insight diário; não muda em 10 min |
| `getGa4Overview` | 10 min | **6 h** | idem |
| `analyticsPorCompetencia` | 30 min | **6 h** | a API já atrasa ~2 dias |
| `detalheDoCanal` | 30 min | **6 h** | 11 consultas por chamada |
| `getGa4Realtime` | — | **não mexer** | tempo real por definição |

Cron a cada 3h com TTL de 6h dá margem: uma execução que falhe não deixa o cache
expirar antes da próxima.

## C.4 · O endpoint

```
POST /api/marketing/aquecer      header x-cron-secret
```

```
aquecer()
  ├─ getPainelMarketing()          ← o mais importante: é a aba inicial
  ├─ getMetaDetail({})             ← variante "todas as marcas"
  ├─ getMetaBreakdowns({})
  ├─ getGa4Overview()
  └─ analyticsPorCompetencia(mês corrente)
```

Decisões:

| Ponto | Escolha | Motivo |
|---|---|---|
| Só a variante "todas as marcas" | sim | é o que a tela abre; aquecer 4 marcas × 2 níveis multiplica por 8 o custo na Graph API |
| Endpoint separado do `sync` | sim | sync escreve, aquecer lê; falha de um não deve abortar o outro |
| Rodar **depois** do sync | sim | aquecer antes do sync guarda o dado velho por 6h |
| Erro em um leitor | não aborta | mesma regra do Painel: degrada por bloco |

`cachedSwr` já aceita `{ force: true }` — o aquecimento força o recálculo em vez
de aceitar um valor ainda válido.

> ⚠️ **`force` não é opcional aqui, é o ponto.** Com TTL de 6h e cron de 3/3h, a
> entrada **ainda está fresca** quando o cron roda: sem `force`, o `cachedSwr`
> devolveria o valor guardado e o aquecimento não faria nada.

### O cron na VPS

Hoje (`crontab -l` em `root@162.243.194.122`):

```cron
0 */6 * * * /root/jarvis-cron.sh marketing      # sync (escreve no banco)
```

A acrescentar — alvo novo `marketing-cache` em `/root/jarvis-cron.sh`:

```sh
  marketing-cache)
    code=$(curl -s -o /tmp/jc_mkt_cache.out -w '%{http_code}' --max-time 290 \
      -X POST "$BASE/api/marketing/aquecer" -H "x-cron-secret: $SECRET")
    echo "$(ts) marketing-cache http=$code resp=$(head -c 300 /tmp/jc_mkt_cache.out | tr -d '\n')" >> "$LOG"
    ;;
```

```cron
15 */3 * * * /root/jarvis-cron.sh marketing-cache
```

O `:15` é deliberado: quando as duas coincidem (a cada 6h), o aquecimento roda
**15 minutos depois** do sync — se rodasse antes, guardaria por 6h o dado
anterior à sincronização.

> Aplicar **junto com o deploy**, não antes: o endpoint só existe na imagem nova.

## C.5 · Detalhe que vale saber

O cache tem duas camadas: **L1 em memória** (por processo) e **L2 em
`cache_kv`** no Supabase (compartilhado e persistente).

Como o L2 é persistente, o aquecimento sobrevive a **redeploy** — o container
novo sobe com o cache já cheio. Com uma réplica só, L1 e L2 aquecem juntos.

## C.6 · Ganho esperado

| | Antes | Depois |
|---|---|---|
| 1ª visita do dia ao Painel | paga todas as integrações | lê do cache |
| Custo de API | por visitante | fixo, 8×/dia |
| Redeploy | volta tudo frio | L2 já quente |

---

# Resumo para decisão

| Frente | Esforço | Migration | Bloqueado? |
|---|---|---|---|
| **C · Cron aquece cache** | baixo | não | não |
| **A · Chat: metas + YouTube B** | baixo | não | não |
| **B.1 + itens 1 e 2** | médio | não | não |
| B · itens 3, 4, 5 | baixo | não | não |
| B · item 6 (histórico) | médio | não | decisão de cache |
| B · item 8 (qualidade) | médio | não | decidir quais métricas |
| B · item 9 (anual) | médio | **sim** | decisão de gestão |
| A · GA4 no chat | baixo | não | **coleta parada** |

**Ordem recomendada: C → A(1,2) → B.1+1+2 → resto.**

O cron é o mais barato e melhora tudo que já existe. O chat corrige uma resposta
errada. As metas evitam decisão errada — e a de 110.000 continua no ar.
