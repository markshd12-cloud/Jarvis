-- 0030_recorrencia_inicio.sql — Competência de INÍCIO da recorrência.
-- Sem isto, toda recorrência materializava já no mês corrente: criada dia 31 com
-- vencimento dia 5, a 1ª parcela nascia VENCIDA (05 do mês já passou). Com
-- `inicio_competencia` ('AAAA-MM'), a materialização só gera de lá em diante —
-- e a periodicidade ANUAL passa a usar o MÊS do início (não mais o de criação).
-- NULL = sem restrição (comportamento antigo).
--
-- Puramente aditivo; mesma segurança do 0023 (RLS service-role-only já ligada).

alter table public.fin_recorrencias
  add column if not exists inicio_competencia text
    check (inicio_competencia is null or inicio_competencia ~ '^[0-9]{4}-[0-9]{2}$');

-- ============================================================================
-- ROLLBACK:
--   alter table public.fin_recorrencias drop column if exists inicio_competencia;
-- ============================================================================
