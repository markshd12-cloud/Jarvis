# Botão "Extrair" — arquitetura da exportação do Financeiro

Escrito em 2026-08-13, a pedido do requisitante, **para validação antes de
implementar**. Nada aqui foi construído.

A especificação não é teórica: nas últimas horas gerei **quatro extrações à mão**
(DRE de agosto, contas a pagar set–dez/2026, contas a pagar 2027, DRE por BU de
ago/2026 a dez/2027). Cada problema listado abaixo foi encontrado fazendo isso —
não imaginado.

Hoje **não existe nenhuma exportação no sistema**: zero rotas com `text/csv` ou
`Content-Disposition`.

---

## 1 · O que aprendi exportando à mão

Estes são os requisitos que só aparecem quando se faz de verdade.

| # | Descoberta | O que o botão precisa fazer |
|---|---|---|
| 1 | Excel pt-BR não abre CSV com vírgula | separador `;` + **BOM** UTF-8 |
| 2 | O PostgREST corta em 1.000 linhas **sem avisar** | paginar sempre (`listParcelas` já faz; consulta nova precisa repetir) |
| 3 | Despesa cancelada infla o total | excluir, como a tela faz — 125 das 242 parcelas de out/2026 são canceladas |
| 4 | Mês futuro **não tem receita emitida** | avisar: o DRE de set/2026 mostra despesa sem receita e "prejuízo" de 6 dígitos que não existe |
| 5 | Mês corrente tem **realizado parcial** | avisar: em ago/2026, 25 das 52 contas vencidas estavam sem baixa |
| 6 | A materialização vai só **12 meses à frente** | avisar: ago/2027 em diante vem vazio — é horizonte, não ausência de despesa |
| 7 | Rateio faz uma parcela pertencer a várias BUs | decidir o formato (ver §5) — somar as visões por BU dá 207 onde há 117 |
| 8 | Existe uma BU **"Geral"** além das três conhecidas | não sumir com ela, ou os arquivos não fecham com o consolidado |

**O item 4 é o mais perigoso.** Um DRE exportado de meses futuros, aberto por
alguém que não participou desta conversa, parece dizer que a empresa vai ter
prejuízo de R$ 106 mil em setembro. Não vai — é despesa lançada contra receita
ainda não emitida. Sem um aviso **dentro do arquivo**, essa planilha vira decisão
errada numa reunião.

---

## 2 · Princípio: o aviso é parte da extração

O requisitante pediu "caso não tenha contas aparecer um aviso". Vou além: **todo
aviso viaja junto com o dado**, e não só o de vazio.

Um arquivo exportado sai do Jarvis e circula sozinho — por e-mail, WhatsApp,
projetor. Quem o abre não tem o contexto de quem o gerou. Então o aviso precisa
estar:

1. **Na tela**, antes de baixar (a pessoa decide se quer mesmo)
2. **No cabeçalho do arquivo**, nas primeiras linhas
3. **Numa aba própria** ("Avisos"), quando for XLSX

### Catálogo de avisos

| Situação | Severidade | Texto |
|---|---|---|
| Zero linhas | 🔴 bloqueia | "Nenhuma conta no período selecionado (01/09 a 31/12). Verifique o filtro." |
| Receita futura ausente | 🔴 crítico | "A partir de 09/2026 não há faturamento emitido. O resultado mostra despesa sem receita e NÃO é previsão de prejuízo." |
| Realizado parcial | 🟡 atenção | "Mês em curso: 25 de 52 contas já vencidas ainda sem baixa. O realizado está subestimado." |
| Fora do horizonte | 🟡 atenção | "A partir de 08/2027 não há parcelas geradas (horizonte de 12 meses). Vazio ≠ sem despesa." |
| Canceladas excluídas | ℹ️ nota | "125 parcelas canceladas foram excluídas, como na tela." |
| Sem conexão CA | 🔴 crítico | "Conta Azul não conectado: receita indisponível; só despesas próprias." |
| BU sem dado | ℹ️ nota | "A BU Unicive não tem lançamento neste período." |

**A regra que evita constrangimento:** aviso crítico aparece **antes** do
download, com confirmação. O usuário pode seguir — mas escolhendo.

---

## 3 · Arquitetura

Uma peça central e uma fonte por relatório. O contrato comum é o que faz o aviso,
o nome do arquivo e o formato saírem iguais em toda extração.

```
lib/financeiro/exportar/
  ├── tipos.ts        Extracao, Coluna, Aviso — o contrato
  ├── csv.ts          serializa (; + BOM + escape) — fase 1
  ├── xlsx.ts         múltiplas abas, larguras, congelar cabeçalho — fase 2
  └── fontes/
      ├── dre.ts               DRE por competência (× BU)
      ├── contas-pagar.ts      parcelas
      ├── contas-receber.ts
      ├── inadimplentes.ts
      ├── fluxo-caixa.ts
      ├── orcamento.ts
      ├── recorrencias.ts      o catálogo, não as parcelas
      └── colaboradores.ts

app/api/financeiro/exportar/route.ts
components/financeiro/botao-extrair.tsx
```

### O contrato

```ts
export interface Extracao {
  /** Vira o nome do arquivo e o título dentro dele. */
  titulo: string;
  colunas: Coluna[];
  linhas: (string | number | null)[][];
  /** Viajam com o dado — ver §2. */
  avisos: Aviso[];
  /** Some no rodapé: "117 linhas · R$ 326.473,16". */
  totais?: Record<string, number>;
}

export interface Coluna {
  chave: string;
  titulo: string;
  tipo: "texto" | "dinheiro" | "data" | "percentual" | "inteiro";
  /** Largura sugerida no XLSX. */
  largura?: number;
}

export interface Aviso {
  nivel: "critico" | "atencao" | "nota";
  texto: string;
}
```

**Por que `tipo` na coluna:** no CSV ele decide a formatação (`1.234,56`); no
XLSX vira formato de célula de verdade, e aí o Excel **soma a coluna** em vez de
tratar como texto. É a diferença entre uma planilha que o financeiro usa e uma
que ele tem que reformatar antes.

### A rota

```
GET /api/financeiro/exportar
      ?fonte=dre|contas-pagar|contas-receber|…
      &de=2026-08&ate=2027-12        ← competências, sempre intervalo
      &bu=<id>|todas|separado
      &formato=csv|xlsx
      &regime=previsto-realizado|competencia   (só DRE)
```

Gated por `can(ctx, "financeiro")`, como a rota do DRE.

`bu=separado` gera **um arquivo por BU** dentro de um `.zip` — foi exatamente o
pedido de hoje ("3 csv, 1 para cada BU"), e evita três cliques.

---

## 4 · O que dá para extrair, por prioridade

| # | Fonte | Existe leitor? | Valor | Esforço |
|---|---|---|---|---|
| 1 | **Contas a pagar** | ✅ `listParcelas` | altíssimo | baixo |
| 2 | **DRE** (× BU, × regime) | ✅ `getDre` | altíssimo | baixo |
| 3 | **Contas a receber** | ✅ Conta Azul | alto | baixo |
| 4 | **Inadimplentes** | ✅ `listarInadimplentes` | alto | baixo |
| 5 | **Fluxo de caixa** | ✅ `fluxo-caixa.ts` | alto | baixo |
| 6 | **Orçamento × realizado** | ✅ `orcamentos.ts` | médio | baixo |
| 7 | **Recorrências** (catálogo) | ✅ `listRecorrencias` | médio | baixo |
| 8 | **Colaboradores** | ✅ | médio | baixo |
| 9 | **Extrato de baixas** | ✅ `listarBaixas` | médio | médio |
| 10 | Receita por BU | ✅ `receitaSnapshotPorCategoria` | médio | médio |

Os leitores **já existem todos**. Isto é trabalho de composição e apresentação,
não de integração — o mesmo que foi o Painel do Marketing.

### Fora do Financeiro, mesma mecânica

| Fonte | Nota |
|---|---|
| Meta Ads por marca/campanha | reusa `getMetaDetail` |
| Metas de marketing | alvo × atual × desvio |
| Tarefas / OKR | ver `gestao-pessoas-brief.md` |

---

## 5 · Duas decisões que mudam o formato

### 5.1 · Rateio: uma linha por parcela ou por fatia?

| Formato | Prós | Contras |
|---|---|---|
| **Uma linha por parcela**, rateio numa coluna de texto (`Colégio 50% = 40,00 \| Unicive 50% = 40,00`) | soma bate com o total; 1 linha = 1 conta | não dá para tabela dinâmica por BU |
| **Uma linha por fatia** (a parcela vira N linhas) | **pivô por BU funciona**; soma por BU direta | a mesma conta aparece várias vezes; quem somar a coluna dobra o valor |

Foi o que eu escolhi na mão (formato A) e é o mais seguro. Mas para **apresentar
a outras pessoas** — que é o pedido — o formato B é muito mais útil no Excel.

**Recomendo oferecer os dois**, com um seletor "Detalhar por BU" e um aviso
explícito no formato B: *"Uma parcela rateada aparece em mais de uma linha. Não
some a coluna Valor sem filtrar por BU."*

### 5.2 · CSV ou XLSX?

| | CSV | XLSX |
|---|---|---|
| Esforço | trivial | precisa de lib (`exceljs`) |
| Abas múltiplas | ❌ | ✅ dado + avisos + resumo |
| Formato de número | texto | **Excel soma sozinho** |
| Cabeçalho fixo / largura | ❌ | ✅ |
| Cores por severidade | ❌ | ✅ |
| Peso | leve | ~1 MB de dependência |

**Recomendo começar por CSV** (fase 1, entrega valor em horas) e **fazer XLSX na
fase 2**, porque "apresentar a outras pessoas" é literalmente o pedido, e uma
planilha que já vem formatada muda a percepção de quem recebe.

O contrato do §3 foi desenhado para o XLSX entrar **sem tocar nas fontes** — só
um serializador novo.

---

## 6 · O botão

```
┌──────────────────────────────────────────────┐
│  Extrair ▾                                   │
├──────────────────────────────────────────────┤
│  Período   [ago/2026]  até  [dez/2027]       │
│  BU        (•) Consolidado                   │
│            ( ) Separado — 1 arquivo por BU   │
│  Formato   (•) Excel (.xlsx)  ( ) CSV        │
│                                              │
│  ⚠️ A partir de 09/2026 não há faturamento   │
│     emitido. O resultado mostra despesa sem  │
│     receita.                                 │
│                                              │
│  117 linhas · R$ 326.473,16                  │
│                        [ Cancelar ] [ Baixar ]│
└──────────────────────────────────────────────┘
```

Três coisas que esse desenho resolve:

**O período já vem preenchido** com o que está na tela. Quem só quer o mês atual
clica em Baixar e pronto; quem quer ago/26 a dez/27 ajusta.

**A contagem aparece ANTES do download.** Se disser "0 linhas", a pessoa corrige
o filtro sem baixar um arquivo vazio e sem entender por quê.

**O aviso aparece antes**, não depois. É a diferença entre a pessoa saber e a
pessoa descobrir na reunião.

---

## 7 · Riscos

| Risco | Mitigação |
|---|---|
| **Extração longa estoura o timeout** — o DRE por BU de 17 meses são 51 chamadas | processar em lote e streamar; ou teto de meses com aviso |
| **Memória** em extração grande | montar linha a linha, não acumular tudo |
| Planilha circula sem contexto | §2 — avisos dentro do arquivo |
| Número diferente da tela | as fontes **reusam os mesmos leitores**; nunca reimplementar a query |
| Dado sensível saindo do sistema | a extração respeita a permissão `financeiro`; considerar registro de quem extraiu |

> ⚠️ **A regra inegociável:** toda fonte de exportação chama o **mesmo leitor** que
> a tela (`getDre`, `listParcelas`, …). Se a exportação reimplementar a consulta,
> um dia ela vai divergir do que está na tela — e a planilha impressa vai
> contradizer o sistema numa reunião.

---

## 8 · Ordem sugerida

| Fase | Entrega | Esforço |
|---|---|---|
| **1** | Contrato + CSV + **Contas a pagar** + botão com período e avisos | baixo |
| **2** | **DRE** (× BU, × regime, `bu=separado` em zip) | baixo |
| **3** | XLSX com abas (dado / avisos / resumo) | médio |
| **4** | Receber, inadimplentes, fluxo de caixa, orçamento | baixo cada |
| **5** | Recorrências, colaboradores, baixas | baixo cada |
| **6** | Exportação no Marketing (mesma mecânica) | médio |

**A fase 1 já elimina o pedido manual.** As três primeiras cobrem tudo que foi
pedido nas últimas horas.

---

## 9 · Perguntas em aberto

1. **XLSX vale a dependência?** (`exceljs`, ~1 MB) — recomendo que sim, pela
   formatação, mas é decisão sua.
2. **Rateio: qual formato é o padrão?** (§5.1)
3. **Teto de período** — 17 meses num clique é aceitável, ou limitamos?
4. **Registrar quem extraiu?** Existe `fin_audit_log`; dado financeiro saindo do
   sistema é candidato natural a rastro.
5. **O botão fica em cada aba ou um só no topo do Financeiro?** Por aba é mais
   óbvio; centralizado permite combinar fontes num arquivo só.
