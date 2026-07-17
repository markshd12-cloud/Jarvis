# DRE v2 — Cutover da despesa (material de decisão)

**Status:** implementado e validado (2026-07-17). Falta **uma decisão de negócio**: a
partir de qual mês o DRE passa a ler a despesa do nosso sistema (Jarvis) em vez do
Conta Azul. Este documento existe pra essa conversa com a liderança.

---

## 1. O que é o cutover, em uma frase

Hoje o DRE lê **toda a despesa do Conta Azul, ao vivo**. O *cutover* é um interruptor
que diz: **"a partir do mês X, leia a despesa das NOSSAS tabelas"**. Meses anteriores
continuam vindo do Conta Azul.

- **Receita:** nunca muda — sempre vem do Conta Azul. O cutover mexe **só na despesa**.
- **Antes de ligar:** nada muda no DRE (comportamento idêntico ao de hoje).
- **Reversível:** desligar o cutover ("Desligado — tudo do Conta Azul") volta tudo ao
  estado atual, na hora.

## 2. Por que fazer isso (o ganho)

O Conta Azul entrega a despesa "crua". Lendo do nosso sistema, passamos a poder:

- **Ratear** uma despesa entre BUs (ex.: aluguel 50% CPPEM / 50% Colégio);
- Atribuir **centro de custo** e **BU** por lançamento;
- Corrigir categoria/estrutura **sem depender** do Conta Azul;
- Ficar **independente do atraso/indisponibilidade** da API do CA no mês fechado.

O DRE passa a refletir a **nossa** organização gerencial, não o espelho bruto do CA.

## 3. Por que é seguro (as travas)

1. **Fallback:** sem cutover, ou em qualquer erro, o DRE lê tudo do CA (= hoje).
   Ligar o código nunca quebrou o DRE.
2. **Sem contagem dupla:** cada mês lê a despesa de **uma fonte só** (CA **ou** Jarvis,
   nunca as duas).
3. **Dedup:** o import das despesas do CA é *insert-only* por identificador do evento —
   rodar de novo nunca duplica.
4. **Portão de conferência:** antes de virar um mês, a tela mostra o **Δ (Conta Azul ×
   Jarvis)** por grupo do DRE. Só se vira com Δ ≈ 0. Esse portão já **pegou** um
   double-count de R$ 1.900 num teste — funcionou.

## 4. A evidência (conferência)

Conferência dos **últimos 12 meses** (feita em 2026-07-17): **Δ = R$ 0,00 em TODOS os
meses** — CA e Jarvis batendo no centavo, R$ 2.001.701,83 dos dois lados.

| Competência | Conta Azul | Jarvis | Δ | OK |
|---|---:|---:|---:|:--:|
| 07/2026 | 228.069,28 | 228.069,28 | 0,00 | ✓ |
| 06/2026 | 252.135,08 | 252.135,08 | 0,00 | ✓ |
| 05/2026 | 264.777,87 | 264.777,87 | 0,00 | ✓ |
| 04/2026 | 209.234,52 | 209.234,52 | 0,00 | ✓ |
| 03/2026 | 197.021,18 | 197.021,18 | 0,00 | ✓ |
| 02/2026 | 193.644,31 | 193.644,31 | 0,00 | ✓ |
| 01/2026 | 141.448,94 | 141.448,94 | 0,00 | ✓ |
| 12/2025 | 122.489,48 | 122.489,48 | 0,00 | ✓ |
| 11/2025 | 129.590,64 | 129.590,64 | 0,00 | ✓ |
| 10/2025 | 89.269,22 | 89.269,22 | 0,00 | ✓ |
| 09/2025 | 81.013,79 | 81.013,79 | 0,00 | ✓ |
| 08/2025 | 93.007,52 | 93.007,52 | 0,00 | ✓ |
| **Total** | **2.001.701,83** | **2.001.701,83** | **0,00** | **✓** |

O detalhamento por grupo do DRE de 07/2026 (todos Δ 0,00): 02 → 20.796,18 · 03 →
45.664,47 · 04 → 33.733,21 · 05 → 127.770,42 · 07 → 105,00.

Para reproduzir: aba **Financeiro → DRE → Gestão do DRE (v2) → "Conferir período"** (mês
a mês) ou o **🔄** da reconciliação (um mês, detalhado por grupo).

## 5. A decisão que a liderança precisa tomar

**A partir de qual mês o DRE deve ler a despesa do Jarvis?**

O cutover é um ponto único "a partir de tal mês". Recomendações:

- **Não precisa migrar o histórico todo.** Escolha o mês em que passamos a **gerenciar
  de fato** as despesas no sistema (rateio/BU/centro de custo). Tudo antes fica no CA,
  como está, sem retrabalho.
- **Só vire meses com Δ ≈ 0** na conferência. Se um mês tiver Δ ≠ 0, é sinal de
  categoria sem correspondência ou lançamento manual duplicado — ajusta-se antes.
- Sugestão conservadora: cutover no **mês corrente** (a partir daqui pra frente),
  deixando o passado no CA. Amplia-se depois, mês a mês, conforme conferido.

## 6. Como ligar (quando decidirem)

Aba **Financeiro → DRE → Gestão do DRE (v2) → seção 3 (Cutover)** → escolher
"A partir de MM/AAAA". O DRE recarrega e o cabeçalho da tabela passa a mostrar o selo
**"Despesa: Jarvis"** nos meses ≥ cutover, e **"Conta Azul"** nos anteriores.

Para reverter: mesmo seletor → "Desligado (tudo do Conta Azul)".

---

*Detalhe técnico completo em `docs/financeiro-status.md` (Passo 11).*
