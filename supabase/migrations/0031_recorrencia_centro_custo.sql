-- 0031_recorrencia_centro_custo.sql — Centro de custo na RECORRÊNCIA.
-- `fin_despesas` já tem `centro_custo_id`, mas a recorrência não carregava o
-- campo: a despesa gerada nascia SEM centro, e toda análise por centro de custo
-- (o "% por Centro de Custo") ignorava as despesas fixas — justamente as maiores.
-- Agora a recorrência guarda o centro e a materialização o repassa à despesa.
-- NULL = sem centro (comportamento atual). `on delete restrict` como as demais
-- dimensões: não se apaga um centro com recorrência pendurada (inativa-se).
--
-- Puramente aditivo; mesma segurança do 0023 (RLS service-role-only já ligada).

alter table public.fin_recorrencias
  add column if not exists centro_custo_id uuid
    references public.fin_centros_custo (id) on delete restrict;

create index if not exists fin_recorrencias_centro_idx
  on public.fin_recorrencias (centro_custo_id);

-- ============================================================================
-- ROLLBACK:
--   drop index if exists public.fin_recorrencias_centro_idx;
--   alter table public.fin_recorrencias drop column if exists centro_custo_id;
-- ============================================================================
