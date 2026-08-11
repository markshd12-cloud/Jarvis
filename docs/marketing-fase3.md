# Marketing — Fase 3: Painel, Modo TV e Contexto no chat

Estruturação escrita em 2026-08-05, a pedido do requisitante, **para validação
antes de implementar**. Nada aqui foi construído ainda.

Decisões já tomadas nesta data:

- **TikTok — desativado.** Integração cara (app no TikTok for Business + OAuth
  próprio) para retorno incerto. Aba removida do dock.
- **Comparativo entre canais — desativado.** Com o TikTok fora sobra **um** canal
  pago (Meta Ads), e comparar canais de mídia entre si perde o sentido. Pior:
  Instagram e YouTube não têm custo atribuído, então qualquer "custo por
  resultado" deles daria **zero**, e o orgânico apareceria como infinitamente
  eficiente. Voltar a isso exige antes uma decisão de gestão sobre como ratear o
  custo de conteúdo entre os canais orgânicos.

As abas saíram do tipo `TabKey` em vez de virarem `ready: false`. "Em breve" é
uma promessa: aba cinza permanente vira ruído e, com o tempo, mentira.

---

# 1 · Painel consolidado

**O que é.** A tela de abertura do módulo: responde "como está o marketing
agora?" sem obrigar a visitar seis abas. Hoje o Marketing tem seis painéis
excelentes e nenhuma visão de conjunto — quem chega precisa saber onde procurar.

**Estado.** ✅ **CONSTRUÍDO em 2026-08-11** — `lib/marketing/painel.ts` +
`components/marketing-painel.tsx`, ligado como **aba inicial** do módulo. Ganhou
dois blocos que não estavam nesta proposta (saúde das fontes e tendência de 90
dias) e um seletor de mês. Ver [`marketing-painel.md`](marketing-painel.md).

## O que já temos para montar (nada de integração nova)

| Fonte | Já entrega | Arquivo |
|---|---|---|
| Meta Ads | investimento, leads, conversas, compras, CPL, custo/conversa, ROAS, CTR — **por marca** e com período anterior para deltas | `lib/marketing/dashboard.ts` |
| Instagram | seguidores, alcance, engajamento, funil (alcance → engajou → perfil → clique) | `social.ts`, `instagram-funnel.ts` |
| YouTube | inscritos exatos ganhos/perdidos, views, watch time, retenção, receita | `youtube-analytics.ts` |
| GA4 | sessões, usuários, conversões, canais, origem/mídia, campanhas, landing pages | `ga4.ts` |
| CAC | custo Marketing+Comercial ÷ vendas, nos 3 regimes, por BU | `cac.ts` |
| Metas | alvo × atual × desvio das 12 metas | `metas.ts` |

**Tudo isto já é lido e cacheado.** O Painel é composição e design, não
integração.

## Estrutura proposta — 5 blocos

### Bloco 1 · A linha do mês
Uma faixa com 4 números grandes e o delta contra o mês anterior:

```
Investimento     Resultados        Custo/resultado      CAC
R$ 18.402        1.295 leads       R$ 14,21             R$ 107,12
▲ 12% vs jul     ▼ 8% vs jul       ▲ 22% vs jul         ▲ 3% vs jul
```

O delta é o que transforma número em informação. `MarketingDashboard` já traz
`previous` pronto — não precisa calcular nada novo.

### Bloco 2 · Semáforo de metas
As metas cadastradas, ordenadas pela **pior** primeiro. Verde/amarelo/vermelho
por faixa de desvio.

É o bloco que dá direção à tela: sem ele, o Painel informa; com ele, ele cobra.

> ⚠️ **Depende de metas cadastradas.** Em 2026-08-11: **3 metas para 11 alvos** —
> e uma delas confunde "ganho no mês" com "total de seguidores", exibindo desvio
> de −108.960. Ordenado pela pior primeiro, é justamente essa que abriria o bloco.
> Ver [`marketing-metas-plano.md`](marketing-metas-plano.md) — arrumar as metas
> vem antes de construir o semáforo.

### Bloco 3 · Distribuição por marca
Barras comparando as 4 marcas em investimento e resultado lado a lado. Responde
"para onde o dinheiro está indo e o que cada real está comprando".

Aqui a comparação é legítima — mesma fonte, mesma unidade, mesmo período.
Diferente do Comparativo entre canais, que foi descartado justamente por não ter
essa propriedade.

### Bloco 4 · Funil consolidado
Pago e orgânico chegando ao mesmo lugar:

```
Meta Ads      impressões → cliques → leads/conversas
Instagram     alcance → engajou → perfil → clique na bio
YouTube       views → retenção → inscritos
GA4           sessões → conversões
```

**Sem somar as etapas entre canais** — "alcance" do Instagram e "impressões" do
Meta não são a mesma coisa, e empilhá-los produziria um número falso. Quatro
funis em paralelo, comparáveis pela *forma*, não pelo total.

### Bloco 5 · Alertas
Regras simples sobre o que já está carregado:

- CPL de uma marca subiu >30% contra o mês anterior
- marca com investimento e **zero** resultado no período
- meta com desvio pior que −20%
- canal do YouTube com saldo de inscritos negativo
- GA4 com % alto de sessões sem atribuição (UTM faltando)

Cada alerta leva à aba correspondente já filtrada.

## Custo e riscos

**Esforço:** médio. ~1 arquivo de composição (`lib/marketing/painel.ts`) + 1
componente + regras de alerta. Sem integração nova, sem migration.

**O risco principal é de performance.** Hoje cada aba carrega só o que precisa
(mudança de 2026-08-05). O Painel é a única tela que precisa de **todas** as
fontes ao mesmo tempo — exatamente o problema que acabamos de resolver. Mitigação:
reusar os caches existentes (SWR de 10–30 min em Meta detail, CAC e YouTube) e
aquecê-los no cron de 6/6h, para a primeira visita do dia não pagar o preço cheio.

✅ **DECIDIDO em 2026-08-11: o Painel será a aba inicial do módulo.** A troca entra
junto com o Painel pronto — promovê-lo antes faria todo mundo aterrissar no
placeholder "em breve". Efeito colateral aceito: quem hoje entra pelo Meta Ads
passa a ver o Painel.

O desenho detalhado (blocos, ordem na tela, saúde das fontes medida) está em
[`marketing-painel.md`](marketing-painel.md).

---

# 2 · Modo TV

**O que é.** Kiosk em tela cheia com carrossel automático dos slides, para
monitor de parede. Números gigantes, alto contraste, sem interação.

**Base pronta:** `components/financeiro/painel-tv.tsx` já faz exatamente isso —
carrossel de 10s, volta ao primeiro no fim, controles de pausar / ← / → / sair, e
**consome o mesmo objeto do Painel, sem fetch próprio**. É o padrão a reusar.

## Dependência dura

**O Modo TV só existe depois do Painel.** Não é preferência de ordem — é
estrutural: o TV do Financeiro consome `PainelResumo`. Sem um objeto consolidado
equivalente no Marketing, o carrossel giraria entre abas operacionais cheias de
tabela, ilegíveis a três metros.

## Slides propostos

| # | Slide | Conteúdo |
|---|---|---|
| 1 | **O mês** | os 4 números grandes + deltas (Bloco 1) |
| 2 | **Metas** | semáforo, pior primeiro (Bloco 2) |
| 3 | **Marcas** | investimento × resultado por marca (Bloco 3) |
| 4 | **Alcance** | seguidores IG + inscritos YouTube + sessões GA4, com variação |
| 5 | **Alertas** | só aparece se houver alerta ativo |

Slide 5 condicional de propósito: um slide "Nenhum alerta" toda rodada treina as
pessoas a ignorar o carrossel.

## O que impacta

**Positivo.** Marketing vira informação ambiente — a equipe vê o CPL subindo sem
abrir o Jarvis. É o tipo de tela que muda comportamento por estar sempre visível.

**Custo operacional a considerar:**

- **Uma aba aberta o dia inteiro recarrega sozinha.** Precisa de intervalo de
  refresh próprio (sugestão: 15 min) e respeitar os caches, ou vira um cliente
  batendo nas APIs do Google e da Meta o dia todo.
- **Sessão expira.** O Financeiro já enfrenta isso; vale conferir como resolveu
  antes de repetir o problema.
- **Dado sensível em tela pública.** O Painel mostra investimento e CAC. Se o
  monitor fica em área de circulação, isso é decisão sua — dá para ter um modo
  TV sem os blocos financeiros.
- **Monitor apagando / proteção de tela** — problema de infra, não de código, mas
  costuma ser o que faz o projeto morrer na prática.

**Esforço:** baixo, **se** o Painel existir. Praticamente adaptar um componente
que já funciona.

---

# 3 · Contexto no chat

**O que é.** Quando alguém pergunta algo de marketing no chat, o Jarvis injeta os
dados reais antes de responder. Já funciona — só que pela metade.

**Estado atual** (`lib/ai/marketing-context.ts`, 9 KB):

| Fonte | Cobertura |
|---|---|
| Meta Ads | ✅ diário dos últimos 35 dias, mês corrente, e período citado na pergunta ("em junho…") |
| YouTube | ⚠️ só o **público arredondado** (`getYoutubeOverview`) |
| GA4 | ❌ nada |
| Instagram orgânico | ❌ nada |
| CAC | ❌ nada |
| Metas | ❌ nada |

Hoje "quantas sessões o site teve?" ou "estamos dentro da meta de CPL?" não
chegam ao modelo com dado nenhum — ele responde no vazio ou diz que não sabe.

## O que falta, em ordem de valor

### 3.1 · Metas — o de maior retorno
"Estamos dentro da meta?" é a pergunta mais natural do chat e a que hoje não tem
resposta. `getMetasComAtual()` já devolve alvo, atual e desvio prontos.

Bloco compacto: uma linha por meta, com o desvio. ~25 linhas.

### 3.2 · CAC
"Quanto custa adquirir um cliente?" — com os três regimes e o corte de fonte
(Conta Azul até jul/2026, banco próprio depois), que o modelo precisa saber para
não comparar períodos indevidamente.

⚠️ Incluir o aviso de que o **realizado está zerado** de agosto em diante, senão
o modelo vai afirmar que o custo caiu a zero.

### 3.3 · GA4
Sessões, usuários, conversões, canais de aquisição e páginas de entrada. É a
fonte que responde sobre o site, hoje invisível ao chat.

### 3.4 · Instagram orgânico
Seguidores por perfil, alcance, engajamento e o funil. Complementa o Meta: a
pergunta "o Instagram está crescendo?" é diferente de "quanto gastamos".

### 3.5 · YouTube nível B
Trocar o bloco atual (público, arredondado) pelo real: ganho **líquido** de
inscritos, watch time, retenção. O público diz "387 mil" há semanas; o real
mostrou **−385 em julho**. O chat hoje repete o número errado.

## Cuidados

**Tamanho do contexto.** Seis blocos de dado a cada pergunta de marketing inflam
o prompt e custam latência e tokens. Os gatilhos (`MARKETING_RE`) devem escolher
**quais** blocos entram: pergunta sobre site traz GA4, não o funil do Instagram.
Isso é mais trabalho do que despejar tudo, e é o que separa útil de pesado.

**Latência.** Tudo já é cacheado, mas a primeira pergunta do dia paga o preço.
O aquecimento no cron resolve os dois problemas de uma vez (aqui e no Painel).

**Ausência ≠ zero.** O padrão do repo já é bom nisso: o bloco só entra se tiver
dado. Vale manter — um bloco "0 sessões" faz o modelo afirmar que o site não teve
visita, quando o certo é que a leitura falhou.

**Esforço:** baixo, e é o único dos três que **não depende de nada nem de
ninguém** — nem de metas cadastradas, nem de decisão de gestão, nem do Painel.

---

# Resumo para decisão

| | Esforço | Depende de | Bloqueado hoje? |
|---|---|---|---|
| **Contexto no chat** | baixo | nada | não |
| ~~**Painel**~~ | ✅ FEITO 2026-08-11 | — | — |
| **Modo TV** | baixo | ~~o Painel existir~~ | **DESTRAVADO** (o Painel existe) |

**Ordem recomendada: chat → painel → TV.**

O chat entrega valor imediato e não espera ninguém. O Painel é o que a diretoria
olha, e desbloqueia o TV. O TV é barato depois do Painel e caro (ou impossível)
antes dele.

## Pendências que atravessam os três

- **`mkt_metas` quase vazia e com uma meta errada.** 3 de 11 alvos preenchidos em
  2026-08-11, e a de seguidores está 100× fora de escala. Afeta o Bloco 2 do
  Painel, o slide 2 do TV e o bloco 3.1 do chat — os três exibiriam o mesmo erro.
  Plano de correção em [`marketing-metas-plano.md`](marketing-metas-plano.md).
- **Cron não aquece cache.** Hoje a primeira visita do dia paga o custo cheio de
  cada integração. Vira gargalo visível no Painel e no TV.
- **CAC com realizado zerado.** Nenhuma parcela do banco próprio foi baixada.
  Qualquer tela ou resposta que use o regime Realizado mostrará zero de agosto em
  diante — e precisa dizer por quê.
