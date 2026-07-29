# Benchmark de Centros de Custo (% ideal) + uso do arquivo de Categorias

Projeto "Plano 4": usar o arquivo **`Categorias de Despesas e Receitas.md`** (diretriz
da liderança) para transformar dados que já temos em **diagnóstico**. Iniciado 2026-07-29.

## Origem
O arquivo traz duas coisas:
1. **Plano de contas** — categorias de receita/despesa agrupadas (01…09).
2. **% ideal por Centro de Custo** — a empresa é **MLG (Marketing-Led Growth)**; cada centro
   tem uma faixa ideal de participação na despesa, meta anual em R$, uma "pergunta prática"
   e exemplos de despesas. Base anual de referência: **R$ 2.487.391,18**.

## Por que vale a pena
O painel **% por Centro de Custo** (Passo 14) já calcula o **% real** de cada centro do Conta
Azul ao vivo. Faltava a **régua**: quanto *deveria* ser. O arquivo é exatamente essa régua.

---

## Fases

> ✅ **Validado (2026-07-29):** `tsc --noEmit` e `eslint` limpos nos arquivos novos (o
> único erro de lint é o pré-existente `void refetch()`, dívida já registrada). O
> classificador (Fase 3) foi rodado contra as **93 categorias de despesa reais** do banco:
> **70% alta confiança · 26% média · 4% sem sugestão** (só 4 casos, todos legitimamente
> ambíguos). Nada commitado/deployado ainda.

### ✅ Fase 1 — Benchmark % real × % ideal (FEITO 2026-07-29)
- **`lib/financeiro/centros-ideal.ts`**: as 10 metas do arquivo como config pura (faixa %,
  meta anual R$, pergunta, exemplos) + `matchCentroIdeal(nome)` (casa o nome do CA com a meta,
  tolerando acento e o singular "Mercadoria" do CA) + `avaliarIdeal(pct, ideal)` →
  dentro/abaixo/acima com o desvio em pontos percentuais (pp).
- **`components/financeiro/centro-custo-panel.tsx`**: nova coluna **"vs. ideal"** — mostra a
  faixa (ex.: "ideal 16–31%") e um selo colorido (Dentro 🟢 / Acima 🔴 / Abaixo 🟡) com o
  desvio. A "pergunta prática" vai no tooltip.
- Sem migration, sem I/O novo — só reusa o `resumoCentrosCusto` existente.

**Como ler:** verde = dentro da faixa; vermelho = gastando **acima** do ideal (atenção); amarelo
= **abaixo** (pode ser folga ou subinvestimento — ex.: Marketing abaixo, numa empresa MLG, é
sinal de alerta, não de economia).

### ⏳ Fase 2 — Metas em R$ + semear o Orçamento
- Usar as metas ANUAIS do arquivo para pré-preencher o **Orçamento & Limite** por
  centro/categoria (conecta com o DRE Orçamentário). Botão "usar metas do documento".
- Mostrar, na visão anual, **real R$ vs meta R$** (além do %).

### ✅ Fase 3 — Classificação categoria → Centro de Custo (assistente READ-ONLY, FEITO 2026-07-29)
- **`lib/financeiro/classificar-centro.ts`** (puro): `sugerirCentro(nome)` com regras de
  palavra-chave dos exemplos do arquivo, em ordem de prioridade, devolvendo confiança
  (alta/media/baixa) + termo que casou. Validado contra as 93 categorias reais: **70% alta,
  26% média, 4% sem sugestão**.
- **`components/financeiro/classificacao-panel.tsx`** + aba **"Classificação sugerida"** no
  shell do Financeiro: tabela read-only (Categoria · Centro sugerido · Faixa ideal · Confiança ·
  Termo) + resumo de cobertura + aviso de que é assistivo. Busca as categorias do endpoint
  existente `/api/financeiro/categorias` e roda o classificador no client — **NÃO grava nada,
  sem migration, sem tocar em painel existente.**
- Uso: padronizar a categorização por centro no Conta Azul. Bugs pegos no teste: `" ia"` (casava
  energIA/férIAs/materIAl) e `"iss"` (casava comISSão/admISSional) — corrigidos.

### ⏳ Fase 4 (futuro) — Persistir o mapa categoria → centro
- Se quiser aplicar as sugestões de forma persistente (para "despesa por BU"/Passo 11), aí sim:
  migration com coluna/tabela de mapa + revisão humana + backfill. Decisão de modelo de dados —
  fora do escopo do read-only atual.

---

## Ressalvas (honestas)
- **% é participação, R$ é anual.** As faixas de % valem para qualquer período (é *share* do
  total). Já as metas em **R$ são anuais** — só comparar direto na visão de ano; para um mês,
  anualizar (×12) ou usar só o %.
- **"Sem centro" dilui o %.** O painel inclui despesa sem centro no total, então o % de cada
  centro fica um pouco menor que o "ideal" (que assume 100% categorizado). Quanto mais
  categorizado no Conta Azul, mais fiel o benchmark. (Possível evolução: calcular o % sobre o
  total **categorizado**.)
- **Faixas se sobrepõem.** A soma dos máximos passa de 100% — é intervalo-guia por centro, não
  orçamento fechado. Não dá para "fechar 100%" somando os ideais.
- **Nome CA × arquivo.** O casamento é por nome normalizado + prefixo. Centros com nome fora do
  padrão aparecem como "—" (sem meta). Se algum centro real não casar, ajustar o mapa em
  `centros-ideal.ts` (1 linha).

## Fonte
Arquivo `Categorias de Despesas e Receitas.md` (raiz do repo), fornecido pela liderança
(criado 27/07/2026). Se as faixas mudarem, editar só `lib/financeiro/centros-ideal.ts`.
