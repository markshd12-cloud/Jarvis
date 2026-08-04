# Importar planilha para o financeiro

Como importar um CSV de despesas para o Jarvis sem duplicar, sem perder coluna e
sem inventar convenção. Escrito depois da importação de 2026-08-04 (22 professores
do Colégio), que **funcionou mas teve três erros evitáveis** — todos documentados
aqui com o que os causou.

O próximo CSV é maior e cobre **recorrências e contas a pagar com parcelamento**,
que são caminhos de dado diferentes. A seção [Os três modelos](#os-três-modelos-de-dado)
explica qual usar.

---

## Os erros de 2026-08-04

### 1. Normalizei a competência sem avisar

O CSV dizia `31/08/2026`. Gravei `2026-08-01`, seguindo a convenção que
`materializar()` usa para toda recorrência (`${competencia}-01`). Não era um bug de
parsing — foi uma decisão minha, tomada em silêncio.

**Custo:** correção de 264 parcelas depois do fato.

**Regra:** todo valor do CSV que eu transformar tem que aparecer no dry-run, com o
"antes → depois" explícito. Se eu normalizo, eu mostro.

### 2. Descartei uma coluna inteira afirmando que não havia campo

O CSV tinha `Forma de pgto: PIX`. Eu disse que não existia lugar para isso no
schema. Existe: **`fin_parcelas.metodo_pagamento`**, texto livre, com `"pix"` entre
os valores sugeridos em `METODOS_PAGAMENTO`.

O erro foi de método: procurei por `forma_pagamento|forma_pgto` e o campo se chama
`metodo_pagamento`. Um grep pelo nome que eu esperava, não pelo conceito.

**Custo:** 264 parcelas gravadas sem método de pagamento.

**Regra:** antes de declarar que um dado "não tem onde ir", listar as colunas reais
da tabela (`select=*&limit=1`) em vez de confiar no grep.

### 3. Afirmei que "o cron regeneraria" sem verificar que existe cron

Usei isso como argumento contra uma opção que o usuário estava avaliando. Não há
agendador nenhum neste repositório — `jarvis.stack.yml` só define `CRON_SECRET`
para o sync de marketing. O endpoint aceita modo cron, mas ninguém o chama.

**Regra:** o risco que eu invoco para influenciar uma decisão é justamente o que eu
mais preciso verificar antes de invocar.

### O que deu certo, e por quê

As 22 despesas do CSV **já existiam no banco**, vindas do Conta Azul como parcelas
`7/12`, `8/12`… Importar direto teria criado **R$ 145.843,16** de despesa fantasma
entre agosto e novembro.

O dry-run pegou porque comparou o *multiconjunto de valores* do CSV com o do banco,
não só a contagem:

```
CSV        : 22 itens | R$ 36.460,79
BANCO 09/26: 22 itens | R$ 36.460,79
>>> MULTICONJUNTO DE VALORES IDENTICO: SIM
```

**Essa comparação é obrigatória.** Nomes divergem ("PROF. GUILHERME FEITOSA" no CSV
vs "GUILHERME FEITOSA" no banco), datas divergem, mas o dinheiro não mente.

---

## Procedimento

### Passo 0 — Contrato do CSV

Colunas usadas em 2026-08-04, e para onde cada uma vai:

| Coluna | Destino | Observações |
|---|---|---|
| `Descrição` | `fin_despesas.descricao` / `fin_recorrencias.descricao` | Sem unicidade. Duplicatas legítimas existem — ver abaixo |
| `Recorrência/Parcelas` | decide o modelo de dado | "Com recorrência (sem parcelas limitada)" → recorrência mensal |
| `Busines Unit` | `fin_parcelas.bu_id` | Resolver por nome; `Geral` é o fallback do import do CA |
| `Forma de pgto` | `fin_parcelas.metodo_pagamento` | Texto livre, minúsculo (`pix`) |
| `Valor (R$)` | `valor_previsto` | Negativo no CSV = despesa. Usar valor absoluto |
| `Data de competência` | `fin_parcelas.data_competencia` | **Gravar o dia que está no CSV** |
| `Data original de vencimento` | `fin_parcelas.data_vencimento` | Junto com a competência, define a defasagem |
| `Categoria` | `fin_despesas.categoria_id` | Resolver por nome normalizado; abortar se não existir |
| `Centro de Custo` | `fin_despesas.centro_custo_id` | Idem |

**Formatos:** valor `"-1.858,33"` (ponto de milhar, vírgula decimal, entre aspas);
data `31/08/2026`; encoding UTF-8 sem BOM. O parser tem que respeitar aspas — há
vírgula dentro de campo.

**Competência × vencimento = defasagem.** Competência 31/08 com vencimento 05/09 é
`defasagem_meses = 1` e `dia_vencimento = 5`. Ver [financeiro-competencia-defasagem.md](./financeiro-competencia-defasagem.md).

### Passo 1 — Dry-run, sem escrever nada

Medir e imprimir, **nesta ordem**:

1. **Contagem e soma** do CSV. Valores inválidos, zerados ou negativos.
2. **Valores distintos de cada coluna categórica** — revela se o arquivo é homogêneo
   ou tem vários casos misturados (o próximo terá).
3. **Descrições repetidas.** Em 2026-08-04, `PROF. PORTUGUES` aparecia 2× com
   valores diferentes (R$ 1.858,33 e R$ 1.596,33): dois professores, mesmo rótulo.
   **Não deduplicar** — mas avisar, porque ficam indistinguíveis na tela.
4. **Resolução de FKs**: categoria, centro de custo, BU. Abortar se alguma não
   existir, nunca criar em silêncio.
5. **Colisão com o que já existe** — a etapa que salva a importação:
   - por descrição normalizada contra `fin_recorrencias`;
   - **por multiconjunto de valores** contra as parcelas do mesmo período/categoria;
   - por mês, mostrando a tabela `competência × nº parcelas × valor × origem`.
6. **Amostra final resolvida**: 2 ou 3 linhas exatamente como serão gravadas —
   competência, vencimento, categoria, BU, centro de custo, método. Foi o que
   faltou em 2026-08-04 e teria pego o erro nº 1.

### Passo 2 — Backup e rollback antes de escrever

Gravar no scratchpad:

- `backup-<escopo>.json` — as despesas, parcelas e recorrências do escopo afetado,
  completas (`select=*`), antes de qualquer escrita;
- `rollback-<escopo>.sql` — SQL que desfaz: reabre parcelas canceladas, apaga o que
  for criado, devolve colunas preenchidas a `null`.

Escrever o rollback **antes** obriga a enunciar o que vai ser tocado.

### Passo 3 — Escrita

- **Guarda de idempotência.** Importação de CSV não tem chave natural (`ca_evento_id`
  só vale para o Conta Azul). Antes de inserir, comparar contra uma chave composta
  — `descricao + valor + categoria_id` para recorrência, mais a primeira
  `data_vencimento` para parcelamento. Rodar duas vezes não pode duplicar.
- **Nunca tocar em parcela paga.** Verificar `status='paga'` no alvo e **abortar** se
  houver, não pular em silêncio.
- **Substituição, não soma.** Se o CSV substitui dado que já existe, cancelar o
  antigo (`fin_parcelas.status='cancelada'` + `fin_despesas.cancelada=true`) na mesma
  execução. Em 2026-08-04 foram 88 parcelas canceladas contra 264 criadas.
- **Materializar pelo código real.** Para recorrências, não reimplementar a lógica
  de datas: subir o build de produção local com `CRON_SECRET` no ambiente do
  processo (sem tocar no `.env.local`) e chamar
  `POST /api/financeiro/recorrencias/materializar` com `x-cron-secret`. Sem body,
  roda `materializarHorizonte` — 12 meses, idempotente por `recorrencia_id + mês`.

### Passo 4 — Verificação

Toda importação termina provando quatro coisas:

1. **Total por mês** bate com o CSV, na competência certa.
2. **Zero duplicatas**: agrupar por `descricao + competência` e listar o que tiver
   contagem > 1. As legítimas (o `PROF. PORTUGUES` duplo) têm que ser reconhecidas
   nominalmente, não escondidas.
3. **O handoff é limpo**: no mês da virada, `rec:N CA:0` — onde o novo entra, o
   velho saiu.
4. **O filtro do app enxerga**: repetir a consulta que a aplicação faz
   (`data_competencia >= mês-01 AND <= ultimoDiaComp(mês)`), incluindo **fevereiro**,
   que é onde um "dia 31" fixo quebraria.

Nenhuma coluna do CSV pode ficar para trás: conferir `null` em cada campo de destino.

---

## Os três modelos de dado

### Recorrência — valor fixo, sem fim

`fin_recorrencias` + materialização gera `fin_despesas` (1 parcela cada) por mês.

- `inicio_competencia` ('AAAA-MM') — primeira competência a gerar;
- `defasagem_meses` — meses entre competência e vencimento (folha/aluguel = 1);
- `dia_vencimento` — dia inválido no mês cai no último (31 em fevereiro → 28);
- `periodicidade` `mensal` | `anual`.

**Armadilha:** `updateRecorrencia` chama `removerFuturosGerados` +
`materializarHorizonte` — editar **apaga e refaz as parcelas futuras não pagas**.
Qualquer ajuste feito direto na parcela (competência, método de pagamento) se perde
na primeira edição da recorrência. Passado e parcela paga nunca se mexem.

### Parcelamento — valor total dividido em N

`fin_despesas` (cabeçalho, `num_parcelas = N`, `valor_total`) + N `fin_parcelas`
com `numero` 1..N. É o que o próximo CSV traz.

- `valor_total` é **denormalizado** e precisa bater com Σ parcelas — é usado para
  conferência;
- dividir **em centavos**, jogando o resto nas maiores fatias, senão a soma não
  fecha (mesma técnica de `expandirPorBu` em `lib/financeiro/rateio.ts`);
- competência e vencimento são **por parcela**, não derivados do cabeçalho;
- não tem materialização: as N parcelas nascem juntas.

### Avulsa

Parcelamento com `N = 1`. Mesmo caminho.

---

## Armadilhas conhecidas

**`.in()` estoura a URL.** Cada UUID custa ~39 caracteres; 1286 ids viram uma URL de
49 KB e o PostgREST devolve **HTTP 400 com corpo vazio** — que no navegador aparece
como `Failed to execute 'json' on 'Response': Unexpected end of JSON input`. Sempre
em lotes de 150–200. Já corrigido em `listRateios`, mas vale para qualquer script.

**Paginação de 1000.** PostgREST corta em 1000 linhas por página, sem avisar.
Qualquer leitura que possa passar disso tem que paginar em laço.

**Fuso.** O servidor é UTC, a operação é `America/Sao_Paulo`. "Mês atual" calculado
no fuso errado já fez uma recorrência não gerar nada. Usar `mesCorrente()` de
`lib/financeiro/competencia.ts`.

**Nunca renovar o token do Conta Azul fora do app.** Rotaciona o `refresh_token` do
Cognito e derruba a produção com `invalid_grant`.

**BU `Geral`.** O import do CA joga tudo em `Geral` (100% das 2046 parcelas
importadas). O que é lançado pelo app já sai com a BU certa. Não confundir o legado
com um defeito do fluxo atual.

---

## Lacunas do sistema

- **`fin_recorrencias` não tem `metodo_pagamento`.** A parcela tem, a recorrência
  não — então o método não se propaga, e some quando a recorrência é editada
  (regeneração). Se o próximo CSV trouxer forma de pagamento por recorrência,
  precisa de migration aditiva + `materializar()` propagando o campo.
- **Convenção do dia da competência está dividida.** 492 parcelas de recorrência no
  dia 01 (o que `materializar()` grava) e 264 no último dia do mês (corrigidas à mão
  em 2026-08-04). Uniformizar exige mudar `materializar()` **e** fazer backfill;
  enquanto não for feito, editar uma das 22 devolve aquelas parcelas ao dia 01.
- **Sem chave natural de dedup para CSV.** `ca_evento_id` só cobre o Conta Azul.
  Cada importação precisa definir e aplicar a sua guarda de idempotência.
