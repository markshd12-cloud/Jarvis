-- 0033_recorrencia_defasagem.sql — Defasagem entre COMPETÊNCIA e VENCIMENTO.
--
-- Despesa paga um mês DEPOIS do período a que se refere (salário, aluguel,
-- pró-labore, FGTS/INSS/DAS, comissão): o trabalho é de julho, o pagamento é em
-- 05/agosto. Sem este campo a materialização forçava as duas datas no mesmo mês,
-- e o custo caía no mês errado do DRE **e** do Fluxo de Caixa (≈45% da despesa
-- mensal). Ver docs/financeiro-competencia-defasagem.md.
--
--   competência = mês M (dia 01)
--   vencimento  = mês (M + defasagem_meses), no dia_vencimento
--
-- 0 = mesmo mês (assinaturas: paga pra usar no mês) — comportamento atual.
-- 1 = paga no mês seguinte (o caso da folha).
-- A coluna é int (aceita 2+, e negativo p/ pagamento antecipado) mas a UI expõe
-- só {mesmo mês, mês anterior} — os únicos casos reais hoje.
--
-- ⚠️ NÃO existe campo equivalente em fin_categorias: a defasagem é decisão do
-- lançamento/recorrência, não padrão por categoria (decisão do requisitante).
--
-- Puramente aditivo; mesma segurança do 0023 (RLS service-role-only já ligada).

alter table public.fin_recorrencias
  add column if not exists defasagem_meses int not null default 0
    check (defasagem_meses between -12 and 12);

-- ============================================================================
-- ROLLBACK:
--   alter table public.fin_recorrencias drop column if exists defasagem_meses;
-- ============================================================================
