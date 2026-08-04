-- 0035_recorrencia_periodicidades.sql — Bimestral, trimestral e semestral.
--
-- A 0023 travou `periodicidade` em ('mensal','anual'). Faltavam os ciclos do
-- meio, que existem de verdade na operação (licença paga por trimestre, seguro
-- semestral, manutenção bimestral) e hoje só cabiam como "mensal" com valor
-- diluído — o que joga custo em meses onde não há saída de caixa.
--
-- Só o CHECK muda. Nenhuma linha existente é tocada: 'mensal' e 'anual'
-- continuam válidos e mantêm exatamente o comportamento atual.
--
-- A regra de geração passa a ser uma só, em `materializar()`:
--   gera quando (meses entre inicio_competencia e a competência) % passo == 0
-- com passo = 1 (mensal), 2, 3, 6, 12 (anual). Para 'anual' isso é equivalente
-- ao "mesmo mês do início" que já valia desde a 0030.

alter table public.fin_recorrencias
  drop constraint if exists fin_recorrencias_periodicidade_check;

alter table public.fin_recorrencias
  add constraint fin_recorrencias_periodicidade_check
  check (periodicidade in ('mensal','bimestral','trimestral','semestral','anual'));

-- ============================================================================
-- ROLLBACK (só funciona se NENHUMA linha usar os valores novos):
--   alter table public.fin_recorrencias
--     drop constraint if exists fin_recorrencias_periodicidade_check;
--   alter table public.fin_recorrencias
--     add constraint fin_recorrencias_periodicidade_check
--     check (periodicidade in ('mensal','anual'));
-- ============================================================================
