-- 0029_recorrencia_rateio.sql — Rateio por BU nas RECORRÊNCIAS.
-- Uma recorrência (aluguel, salário…) pode dividir a despesa gerada entre BUs
-- por percentual — ex.: aluguel 60% Colégio / 30% CPPEM / 10% Unicive. O rateio
-- fica aqui como JSON (array de {bu_id, percentual}, Σ=100% validado na app) e,
-- na MATERIALIZAÇÃO, vira linhas em `fin_despesa_rateio` na parcela gerada —
-- o mesmo mecanismo do rateio manual do Contas a Pagar (0023 §8).
-- NULL / [] = sem rateio (100% na bu_id da recorrência, comportamento atual).
--
-- Puramente aditivo; mesma segurança do 0023 (RLS service-role-only já ligada).

alter table public.fin_recorrencias
  add column if not exists rateio jsonb;

-- ============================================================================
-- ROLLBACK:
--   alter table public.fin_recorrencias drop column if exists rateio;
-- ============================================================================
