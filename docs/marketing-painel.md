# Painel do Marketing — desenho

Escrito em 2026-08-11. Sucede a proposta de 5 blocos de
[`marketing-fase3.md`](marketing-fase3.md) §1, agora com **decisão tomada** e com
o estado real de cada fonte medido, não suposto.

> ✅ **CONSTRUÍDO em 2026-08-11.** `lib/marketing/painel.ts` (composição) +
> `components/marketing-painel.tsx` (7 blocos), ligado como **aba inicial**.
> Este documento deixou de ser proposta e passou a descrever o que existe.
> O que foi ALÉM da proposta: faixa de saúde das fontes, tendência de 90 dias com
> custo/resultado em média móvel, e seletor de mês por `?comp` (o mesmo da aba
> Metas).

---

## 1 · O que as fontes realmente entregam hoje

Medido em 2026-08-11. **Esta tabela é a base do desenho** — não adianta desenhar
um bloco lindo sobre uma fonte que parou de coletar.

| Fonte | Estado | Dado mais recente |
|---|---|---|
| **Meta Ads** | ✅ saudável | 11/08, 4 marcas |
| **Instagram** | ✅ saudável | 11/08, 5 perfis |
| **YouTube** | ✅ saudável | 1 conexão OAuth cobrindo os 2 canais |
| **GA4 / Site** | ❌ **parado** | **29/07** — zero sessões em agosto |
| **CAC** | ⚠️ parcial | previsto OK; realizado depende de baixas |
| **Metas** | ⚠️ 3 de 11 alvos | uma delas errada por 100× |

### 1.1 · GA4 não coleta desde 29/07 — e a causa é um caminho errado

A propriedade tem **12 dias com dado na vida inteira**, de 16 a 29 de julho. O
pico foi 233 sessões em 21/07; depois caiu para 1–5 por dia e **parou em 29/07**.
Agosto inteiro: zero. Tempo real: zero usuários ativos. Nenhum evento em 7 dias.

**Não é a nossa integração.** Tudo que dá para inspecionar de fora está correto:

| Camada | Estado (medido 2026-08-11) |
|---|---|
| Auth do service account | ✅ token sai, API responde |
| Propriedade + fluxo de dados | ✅ `G-HZE53T0J6P` → `https://cppem.com.br` |
| Servidor sGTM `sgtm.cppem.com.br` | ✅ no ar, `/healthz` = `ok` |
| Loader no site (`/metrics/`) | ✅ **HTTP 200**, 369 KB do container |
| Tag do GA4 no container web | ✅ presente (`__googtag`), **não pausada** |
| `server_container_url` da tag | ✅ `https://sgtm.cppem.com.br` (raiz) |

> ⚠️ **Correção de um diagnóstico errado.** A primeira versão deste documento
> afirmava "descasamento de caminho: o site pede `/metrics/*` e o servidor só
> responde na raiz". **Errado.** Eu testei `/metrics/gtm.js` (400) e concluí — mas
> esse esquema de *custom loader* serve o script no caminho **sem nome de
> arquivo**: `https://sgtm.cppem.com.br/metrics/` devolve **200** com o container
> inteiro. O carregamento funciona. O 400 era do nome de arquivo que inventei.

**CAUSA ISOLADA** (2026-08-11, com hits reais capturados no DevTools):

```
navegador  →  sgtm.cppem.com.br     ✅ 200 OK, devolve cookie FPID
sgtm       →  Google Analytics      ❌ nada chega (0 eventos em 7 dias)
navegador  →  Google Ads            ✅ 200 OK (AW-17332184690 funciona)
```

A quebra é **dentro do container do servidor**: o cliente GA4 recebe e aceita, mas
nenhuma tag encaminha para o Google. Nada acusa erro — do ponto de vista do
navegador, tudo respondeu 200.

**Suspeito nº 1:** o evento chega como `PageView_Cppem`, nome customizado. A
propriedade nunca registrou esse nome. Se a tag GA4 do servidor tem gatilho
filtrado por nome de evento, um rename a desliga em silêncio — e encaixa com o
corte seco em 29/07.

Detalhe importante: **o Google Ads continua medindo** (vai direto ao
`www.google.com`, sem passar pelo servidor). Só o GA4 caiu. É por isso que ninguém
percebeu — as campanhas seguiam reportando conversão.

Conserto é no **GTM**, container do Servidor → Tags. Passo a passo em
[`ga4-sgtm-diagnostico.md`](ga4-sgtm-diagnostico.md).

Consequência para o Painel: **o bloco de GA4 não pode ser desenhado como se
houvesse dado.** Mostrar "0 sessões" ao lado de números saudáveis do Meta Ads faz
o leitor concluir que o site morreu, quando o que morreu foi a medição. As duas
saídas honestas são omitir o bloco enquanto não coletar, ou mostrá-lo com o aviso
explícito de que a coleta parou em 29/07 — ver §3.4.

### 1.2 · A armadilha que vai fazer o Painel mentir

`marketing_daily_insights` guarda **duas famílias de linha para o mesmo dia**: uma
por marca, e uma com `brand = null` que é o **agregado da conta**. Verificado em
agosto:

```
linhas COM marca      27  →  R$ 6.069,58
linhas SEM marca      11  →  R$ 6.069,58   (mesmo dinheiro, agregado)
somar tudo                →  R$ 12.139,16  ← DOBRO
```

Quem montar o bloco consolidado somando a tabela inteira vai publicar **o dobro do
investimento real**, e o número parecerá plausível. O mesmo vale para leads (639
viram 1.278) e conversas (57 viram 114).

**Regra:** todo agregado do Painel filtra `brand IS NOT NULL`. `dashboard.ts` já
faz isso; qualquer consulta nova precisa repetir.

---

## 2 · O princípio do desenho

O Painel responde **uma** pergunta: *"como está o marketing agora, e o que precisa
da minha atenção?"*

Isso implica três recusas:

- **Não é resumo de todas as abas.** Se cada aba mandasse seu melhor gráfico, o
  Painel viraria índice ilustrado. Ele mostra o que muda decisão.
- **Não repete o que a aba faz melhor.** Detalhe é da aba. O Painel dá o número e
  o caminho até ele.
- **Não soma o que não se soma.** Alcance do Instagram e impressões do Meta não são
  a mesma unidade; empilhá-los produz um número que não existe.

**Leitura em três alturas**, para servir a quem passa 10 segundos e a quem senta
para analisar:

| Altura | Tempo | O quê |
|---|---|---|
| 1 | ~5s | está bom ou ruim? — faixa de números grandes |
| 2 | ~30s | o que precisa de atenção? — alertas e semáforo |
| 3 | ~2min | por quê? — marcas, funil, tendência |

---

## 3 · Os blocos

### 3.0 · Faixa de saúde do dado (novo)

Uma tira fina no topo, antes de qualquer número:

```
Meta Ads ✅ 11/08   ·   Instagram ✅ 11/08   ·   YouTube ✅   ·   GA4 ⚠️ parado desde 29/07
```

**Não estava na proposta original, e é o bloco mais importante que falta.** Um
painel consolidado é exatamente onde uma fonte quebrada passa despercebida: o
leitor vê seis blocos, cinco com números bonitos, e não tem como saber que o sexto
está congelado há duas semanas. Foi o que aconteceu com o GA4 — parou em 29/07 e
ninguém notou até eu medir hoje.

Verde quando a fonte tem dado de ontem ou hoje; amarelo até 3 dias; vermelho acima
disso. Regra barata, e é o que separa um painel confiável de um painel bonito.

### 3.1 · A linha do mês

Quatro números grandes com variação contra o mesmo intervalo do mês anterior — não
contra o mês fechado, que compararia 11 dias com 31.

Com dados reais de hoje (1–11/08 contra 1–11/07):

```
Investimento        Resultados          Custo/resultado      Inscritos + Seguidores
R$ 6.069,58         639 leads           R$ 8,72              +1.040 no mês
▼ 16% vs julho      57 conversas        ▲ 33% vs julho       (Instagram, 5 perfis)
                    ▼ 47% vs julho
```

> A queda de conversas (635 → 57 no mesmo intervalo) é real e enorme. Um Painel em
> produção já teria mostrado isso — é exatamente o tipo de coisa que ele existe
> para pegar.

**O quarto número é decisão sua.** A proposta original punha CAC ali. Com o
realizado dependendo de baixas lançadas, ele pode aparecer zerado e assustar. A
alternativa é crescimento de audiência (seguidores + inscritos), que é 100%
Marketing e sempre tem dado. Sugiro audiência no Painel e CAC na aba própria,
coerente com a decisão de que CAC não é meta daqui.

### 3.2 · Alertas — o bloco que dá utilidade ao resto

Sobe para a segunda posição (era o quinto). Motivo: o que exige ação deve vir
antes do que informa.

Regras sobre dado já carregado:

- custo por resultado de uma marca subiu >30% contra o mês anterior
- marca com investimento e **zero** resultado no período
- meta com desvio pior que −20%
- canal do YouTube com saldo de inscritos negativo
- **fonte parada há mais de 3 dias** (nova — casada com §3.0)

Cada alerta é clicável e leva à aba correspondente já filtrada. Sem alerta, o
bloco **some** — não vira "tudo certo ✅", que treina as pessoas a pular a região.

### 3.3 · Semáforo de metas

As metas ordenadas da pior para a melhor, com o desvio.

> ⚠️ **Bloqueado na prática.** Hoje são 3 metas para 11 alvos, e a de seguidores do
> CPPEM Concursos está 100× fora de escala (110.000 onde cabia ~2.000), exibindo
> desvio de −108.960. Ordenado por "pior primeiro", **é essa que abriria o bloco** —
> o item mais visível do Painel seria um erro de digitação.
>
> Ver [`marketing-metas-plano.md`](marketing-metas-plano.md) §2.1 e §2.2: a
> comparação de meta acumulada no meio do mês também precisa de ritmo, senão toda
> meta de seguidor nasce vermelha todo dia 1º.

Enquanto as metas não forem arrumadas, o bloco deve mostrar quantas faltam
("3 de 11 definidas") em vez de fingir cobertura.

### 3.4 · Distribuição por marca

Barras com investimento e resultado lado a lado, nas 4 marcas. Responde para onde
o dinheiro foi e o que cada real comprou.

Aqui a comparação é legítima — mesma fonte, mesma unidade, mesmo período. É a
diferença para o Comparativo entre canais, descartado justamente por não ter essa
propriedade.

Com dado real de agosto, a leitura salta aos olhos:

| Marca | Gasto | Leads | Conversas | Custo/lead |
|---|---|---|---|---|
| CPPEM Concursos | R$ 3.002,45 | 279 | 13 | R$ 10,76 |
| Unicive | R$ 2.700,21 | 344 | 31 | R$ 7,85 |
| Everton | R$ 325,42 | 15 | 12 | R$ 21,69 |
| Colégio | R$ 41,50 | 1 | 1 | R$ 41,50 |

94% do investimento está em duas marcas. Isso é informação de gestão que hoje
exige abrir a aba e somar na cabeça.

### 3.5 · Funil

Quatro funis em paralelo, comparáveis pela **forma**, nunca pelo total:

```
Meta Ads      impressões → cliques → leads/conversas
Instagram     alcance → engajou → perfil → clique na bio
YouTube       views → retenção → inscritos
GA4           sessões → conversões          ⚠️ sem coleta desde 29/07
```

O funil do GA4 entra **com o aviso**, não escondido: um funil ausente sugere que
não existe site; um funil marcado como parado convida a consertar a tag.

### 3.6 · Tendência (novo)

Uma faixa de sparklines dos últimos 90 dias: investimento, resultados, custo por
resultado, seguidores.

Os cinco blocos originais respondem "como está**mos**". Nenhum responde "para onde
esta**mos indo**", que é a pergunta que muda orçamento. Uma linha de 90 dias
distingue "o custo está alto" de "o custo vem subindo há seis semanas" — conversas
diferentes, decisões diferentes.

Barato: os dados diários já estão na tabela e o kit `components/charts/*` já existe.

---

## 4 · Ordem na tela

```
┌─ saúde do dado ────────────────────────────────┐  fina, discreta
├─ a linha do mês ───────────────────────────────┤  4 números grandes
├─ alertas ──────────────────────────────────────┤  só se houver
├─ semáforo de metas ────────────────────────────┤
├─ distribuição por marca ───────────────────────┤
├─ tendência 90 dias ────────────────────────────┤
└─ funis ────────────────────────────────────────┘  o mais denso por último
```

Do que exige ação para o que dá contexto. Quem tem 10 segundos lê os dois
primeiros e vai embora com o essencial.

---

## 5 · Desempenho

O risco principal continua sendo este: **é a única tela que precisa de todas as
fontes ao mesmo tempo** — exatamente o problema que a mudança de 05/08 resolveu ao
fazer cada aba carregar só o que precisa.

Mitigações, em ordem:

1. **Reusar os caches existentes** (SWR de 10–30 min no detalhe do Meta, CAC e
   YouTube). O Painel não deve ter caminho de leitura próprio.
2. **Aquecer no cron de 6/6h**, para a primeira visita do dia não pagar o preço
   cheio. Hoje o cron não aquece nada — é dívida conhecida, e vira gargalo visível
   justamente aqui.
3. **Degradar por bloco, nunca a tela.** Fonte que falha derruba o próprio bloco e
   acende vermelho na faixa de saúde. `metas.ts` já faz isso com o YouTube; é o
   padrão a repetir.

---

## 6 · A aba inicial

Decidido: o Painel abre o módulo.

**A troca entra junto com o Painel pronto, não antes.** Hoje `marketing-shell.tsx`
escolhe a primeira aba com `ready: true`, e o Painel está com `ready: false`
mostrando um placeholder. Promovê-lo agora faria todo mundo aterrissar num "em
breve" — pior que o comportamento atual.

Duas linhas mudam quando chegar a hora: `ready: true` no item `painel` e mover o
item para o começo de `TABS`. O `firstReady` já resolve o resto sozinho.

Vale lembrar o efeito colateral: quem hoje usa Meta Ads como tela de entrada vai
passar a ver o Painel. É o objetivo, mas é mudança de hábito de quem já usa.

---

## 7 · O que precisa acontecer antes

Em ordem, e nenhum deles é código do Painel:

1. **Consertar a meta de 110.000** — senão o semáforo estreia com ela no topo.
2. **Alinhar o caminho do sGTM** (§1.1) — o site pede `/metrics/*`, o servidor
   responde na raiz. Sem isso o bloco de site nasce zerado. A tag existe; é o
   endereço que está errado.
3. **Configurar eventos-chave no GA4** — sem isso não há conversão para medir.
4. **Preencher as 8 metas que faltam** — o semáforo cobre 27% dos alvos hoje.

Nada disso impede começar o Painel. Mas os quatro decidem se ele nasce útil ou
decorativo.
