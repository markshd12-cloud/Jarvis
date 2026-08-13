# Hub de Gestão de Pessoas — brief para mapa mental

Documento de **debate**, não de decisão. Reúne a ideia original do requisitante,
a contraproposta, onde as duas convergem, onde divergem, e o que foi **medido** no
caminho. Serve de base para juntar mais ideias antes de virar plano.

Discussão de 2026-08-12. Nada aqui foi construído.

---

## 1 · O objetivo, nas palavras do requisitante

> "Visualizar o aproveitamento, sobrecarregamento, quem tá entregando e quem tá
> atrasando, quem está completando realmente os processos de OKRs (que são as
> tarefas ligadas a algum crescimento financeiro)."

E, do lado do colaborador: um lugar onde ele consiga trabalhar **sem sair do
Jarvis**.

---

## 2 · O que JÁ existe (medido, não suposto)

| Peça | Estado |
|---|---|
| Tabela `tasks` | ✅ **5.007** linhas, espelho do Notion (migration 0018) |
| Pessoas em `assignees` | ✅ 31 nomes distintos |
| `profiles` (usuários do Jarvis) | ✅ 23 |
| Prazo (`due_date`) | ✅ 91% preenchido |
| Status | ✅ Concluída 3.323 · Cancelada 1.017 · Não iniciada 441 · Em andamento 50 |
| Atividades diárias (Notion) | ⚠️ existe, mas como **texto em RAG**, não estruturado |
| OKR por tarefa | ❌ **ver §6** |

**Conclusão:** ~70% do encanamento de dados já está pronto. O que falta é
composição e duas correções de origem.

---

## 3 · A ideia original — item a item

| # | Ideia | Veredito | Por quê |
|---|---|---|---|
| 1 | Puxar bancos do Notion (atividades diárias) | ✅ **manter** | já sincronizamos; falta estruturar |
| 2 | Tarefas em aberto por usuário | ✅ **manter** | dado pronto |
| 3 | OKRs atribuídos | ⚠️ **bloqueado** | ver §6 |
| 4 | Tela para o colaborador | ✅ **é a parte mais forte** | ver §5 |
| 5 | Heatmap de "quem usa o Jarvis" | ❌ **descartar** | ver §4 |
| 6 | Quem entrega / quem atrasa | ⚠️ **reformular** | ver §4 |

---

## 4 · Onde divergimos

### 4.1 · O heatmap de uso do Jarvis

**Prós (a favor da ideia original)**
- Responde "a equipe adotou a ferramenta?"
- Dado fácil de coletar
- Útil para decidir se vale investir mais no produto

**Contras**
- **Mede presença, não entrega.** Premia quem deixa a aba aberta e pune quem
  resolve fora e volta só para registrar.
- **Destrói a própria fonte.** Quando a equipe entende que o uso é medido, o
  Jarvis vira ponto eletrônico: as pessoas usam para aparecer, o dado vira ruído,
  e a adoção real cai. Perdem-se as duas coisas.
- **LGPD.** Monitoramento individual de empregado é dado pessoal de trabalhador —
  exige base legal e transparência.

**Proposta de meio-termo:** manter só o **agregado sem nome** ("usuários ativos
na semana"), que serve para decisão de produto e não para avaliação de pessoa.

> ⚠️ **Distinção que resolve o dilema de transparência:** tarefa, prazo, status e
> responsável **já são visíveis a todos no Notion**. Agregar isso no Jarvis não é
> vigilância nova — é parar de somar na mão. O único dado que seria **novo** é o
> uso do Jarvis. Descartando ele, a questão da comunicação com a equipe some.

### 4.2 · Ranking de pessoas

**Prós**
- Direto, fácil de ler, cria senso de comparação

**Contras**
- **Mede estimativa de prazo, não entrega.** Quem estima com folga parece ótimo;
  quem estima honestamente parece atrasado.
- **Ignora tamanho.** Itallo tem 658 tarefas, Mark tem 138 — não diz nada sobre
  valor entregue. "Responder e-mail" e "reestruturar o financeiro" contam igual.
- **Ignora papel.** Comparar pessoas com funções diferentes compara o
  incomparável.

**Alternativa proposta:** comparar a pessoa **com ela mesma ao longo do tempo**.
"Fulano está com 12 tarefas vencendo esta semana, contra média de 4" informa;
"Fulano é o 7º do ranking" não.

### 4.3 · Cancelamento como métrica

O requisitante respondeu que cancelar "não é ruim, porém depende" — e é justamente
por isso que não pode virar nota.

**Proposta:** cancelamento vira **contexto, não pontuação**. 40% de cancelamento
não é "ruim", é uma pergunta: as prioridades mudam demais? a pessoa pega o que não
devia? o planejamento está errado?

Separar tipos exigiria um campo de motivo no Notion — barato de criar, caro de
manter, e só se descobre se está sendo preenchido meses depois.

---

## 5 · Onde convergimos

### 5.1 · A tela do colaborador vem primeiro

Convergência total, e é a decisão mais importante do documento.

```
colaborador usa porque AJUDA  →  dado honesto aparece  →  painel de gestão vira real
colaborador é medido          →  dado vira teatro      →  painel mede teatro
```

**"Meu dia"**: minhas tarefas abertas, o que vence hoje, meu OKR, e o registro da
atividade diária sem abrir o Notion.

Se ninguém usar, o painel de gestão mediria nada de qualquer forma. A ordem não é
preferência — é dependência.

### 5.2 · Painel de OKR — por OKR, não por pessoa

"Conseguir um CRM eficiente" está andando? Quantas tarefas abertas, quantas
atrasadas, quem está nelas.

Responde a pergunta financeira (que é o que o requisitante definiu como OKR) sem
virar avaliação individual.

### 5.3 · Sobrecarga é o alerta mais útil

Descobrir que alguém está afogado **antes** de estourar vale mais que qualquer
ranking. E é a métrica que a equipe recebe bem, porque trabalha a favor dela.

---

## 6 · O achado técnico que trava o item 3

Durante a discussão, o requisitante contestou o número de cobertura de OKR. Ele
estava certo, e a investigação revelou **dois problemas independentes**:

### 6.1 · O sync de tarefas nunca foi agendado ✅ CORRIGIDO

`/api/tasks/sync` existia, funcionava, e **nenhum cron o chamava**. O alvo
`jarvis-cron.sh notion` aponta para `/api/notion/sync`, que é o **RAG dos
relatórios** — outra coisa.

Última sincronização: **04/08**, oito dias antes. Ao rodar manualmente:
**4.836 → 5.007 tarefas** (+171).

**Corrigido em 2026-08-12:** alvo `tasks` no `jarvis-cron.sh` + `40 */6 * * *` no
crontab.

### 6.2 · As propriedades OKR e Objetivo foram REMOVIDAS do Notion 🔴 ABERTO

O banco de tarefas hoje tem estas propriedades — e **nenhuma relation**:

```
TAREFA (title) · STATUS · PRAZO · PRIORIDADE · Descrição
RESPONSmÁVEL (people) · ATRIBUIÇÃO (multi_select) · URL · ÚLTIMA EDIÇÃO
```

O código resolve `okr` e `objetivo` a partir de **relations** (`lib/notion/tasks.ts`).
Sem elas, o campo grava `null` — e o `catch {}` do `loadTitleMap` engole o
problema sem log.

Como o sync é **incremental** (watermark por `last_edited_time`), as linhas
antigas mantêm o valor de quando o campo existia. Daí o padrão:

| Mês | Tarefas | Com OKR |
|---|---|---|
| ago/26 | 314 | **0%** |
| jul/26 | 543 | 9% |
| jun/26 | 731 | **16%** |
| mai/26 | 689 | 4% |
| abr/26 e antes | 2.730 | 0% |

**Zero absoluto em 314 tarefas não é decadência de processo — é campo inexistente.**

> **Sem restaurar esse vínculo no Notion, o item "OKRs atribuídos" não tem como
> existir.** Não é problema de painel; é de processo na origem. Nenhum dashboard
> conserta um campo que não existe.

### 6.3 · O campo `ATRIBUIÇÃO` é uma incógnita útil

`multi_select` com valores `70%`, `20%`, `10%` — 3.937 tarefas vazias, 899
preenchidas. Parece rateio de esforço ou de crédito.

**Se for o que parece, é mais útil para "aproveitamento" que o próprio OKR**,
porque diz *quanto* daquela entrega é da pessoa. Precisa de confirmação de quem
desenhou o processo.

---

## 7 · Ideias adicionais (nem minhas nem suas — para o mapa)

Coisas que não foram levantadas por nenhum dos dois e podem valer.

### 7.1 · Sobre o trabalho

| Ideia | Prós | Contras |
|---|---|---|
| **Tarefas travadas** (sem edição há N dias) | acha o que está esquecido, não quem falhou | precisa calibrar o N |
| **Tempo de ciclo** (criação → conclusão) | mede fluxo real | contamina com tarefa criada com meses de antecedência |
| **Retrabalho** (tarefa reaberta) | sinal de qualidade | Notion pode não guardar histórico de status |
| **Distribuição por OKR** | mostra se o esforço vai ao que importa | depende de §6.2 |
| **Previsão de estouro** — no ritmo atual, o OKR fecha no prazo? | antecipa em vez de constatar | precisa de série histórica |

### 7.2 · Sobre as pessoas (com cuidado)

| Ideia | Prós | Contras |
|---|---|---|
| **Carga vs. capacidade declarada** | a pessoa diz quanto cabe; o sistema compara | exige input humano semanal |
| **1:1 assistido** — o Jarvis prepara a pauta da conversa com o que aconteceu | usa o dado a favor da pessoa | vira "prontuário" se mal feito |
| **Reconhecimento automático** — quem fechou algo grande aparece | inverte o sinal: mede para elogiar | pode virar concurso de popularidade |
| **Autoavaliação vs. dado** | a pessoa compara sua percepção com o registro | só funciona se ela confiar no sistema |

### 7.3 · Sobre o Jarvis como ferramenta

| Ideia | Prós | Contras |
|---|---|---|
| **Registro da atividade diária dentro do Jarvis** | mata o atrito do Notion; alimenta tudo | precisa escrever de volta no Notion ou virar fonte |
| **Resumo semanal por e-mail/WhatsApp** | chega sem precisar abrir | mais um canal para manter |
| **Chat sabendo das tarefas** | "o que tenho pra hoje?" — já existe base (`lib/ai/tasks.ts`) | contexto grande |
| **Alertas de prazo no WhatsApp** | onde a equipe já está | vira spam se mal calibrado |

### 7.4 · Perguntas que o Hub deveria responder (e hoje ninguém responde)

- Quanto do nosso esforço vai para OKR e quanto vai para operação/apagar incêndio?
- Que OKR está sem ninguém trabalhando nele há duas semanas?
- Qual time tem mais tarefa vencida — e é falta de gente ou de prioridade?
- Quantas tarefas entram por semana vs. quantas saem? (a fila cresce ou diminui?)
- O que foi cancelado neste mês, e por quê?

---

## 8 · Riscos do projeto como um todo

| Risco | Mitigação |
|---|---|
| Virar ferramenta de vigilância percebida | só dado já visível no Notion; nada de métrica de uso |
| Medir o que é fácil em vez do que importa | métrica que gera **pergunta**, não nota |
| Painel bonito sobre dado ruim | §6.2 antes de qualquer tela |
| Goodhart — a métrica vira meta e deixa de medir | nenhuma métrica individual com consequência automática |
| Adoção morrer | tela do colaborador primeiro, sempre |

---

## 9 · Perguntas em aberto

1. **`ATRIBUIÇÃO` (70/20/10)** — o que significa no processo de vocês?
2. **O vínculo OKR ↔ tarefa vai voltar ao Notion?** Sem ele, §3 item 3 não existe.
3. **"Aproveitamento" é ocupação ou efetividade?** São painéis opostos.
4. **Atividade diária: o Jarvis lê do Notion ou passa a ser onde se escreve?**
   A segunda é mais útil e muito mais cara.
5. **Quem é o público do painel de gestão** — só diretoria, ou líderes de time
   também? Muda o que pode aparecer.

---

## 10 · Ordem sugerida, se virar projeto

| # | Etapa | Depende de |
|---|---|---|
| 0 | ~~Cron do sync de tarefas~~ | ✅ feito 2026-08-12 |
| 1 | Restaurar OKR ↔ tarefa no Notion | **vocês** |
| 2 | Espelho estruturado das atividades diárias | nada |
| 3 | Tela "Meu dia" (colaborador) | 2 |
| 4 | Mapa `assignees` → `profiles` | nada |
| 5 | Painel por OKR | 1, 4 |
| 6 | Alerta de sobrecarga | 4 |
| 7 | Agregado de adoção (sem nome) | nada |

**A etapa 1 é de vocês e bloqueia a 5** — que é justamente o que o requisitante
mais quer ver.
