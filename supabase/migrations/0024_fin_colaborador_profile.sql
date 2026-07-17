-- 0024_fin_colaborador_profile.sql
-- Vincula Colaboradores financeiros aos usuários da empresa (public.profiles),
-- para que a identidade seja única (mesmo "funcionário" do painel de Empresas) e
-- os dados financeiros (PII: pix/conta/salário) fiquem no fin_colaboradores.
--
-- Puramente aditivo: uma coluna nullable + um índice único parcial. Nenhum
-- ALTER/DROP destrutivo. `on delete set null` = apagar o usuário solta o vínculo
-- sem apagar o colaborador (histórico financeiro preservado).

alter table public.fin_colaboradores
  add column if not exists profile_id uuid
    references public.profiles (id) on delete set null;

-- Um colaborador financeiro por usuário, por empresa (só quando vinculado).
create unique index if not exists fin_colaboradores_profile_uk
  on public.fin_colaboradores (company_id, profile_id)
  where profile_id is not null;

-- ============================================================================
-- ROLLBACK (rodar manualmente se precisar reverter):
--   drop index if exists public.fin_colaboradores_profile_uk;
--   alter table public.fin_colaboradores drop column if exists profile_id;
-- ============================================================================
