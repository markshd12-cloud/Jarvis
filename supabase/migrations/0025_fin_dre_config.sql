-- 0025_fin_dre_config.sql — Passo 11 (DRE v2 / cutover).
-- Uma linha por empresa. `cutover_competencia` = 1ª competência (AAAA-MM) em que
-- o DRE lê a DESPESA das NOSSAS parcelas (fin_parcelas) em vez do Conta Azul.
-- Competências ANTERIORES ao cutover continuam lendo a despesa do CA ao vivo.
-- NULL / sem linha = TUDO do CA (fallback seguro = comportamento atual de hoje).
--
-- A RECEITA nunca muda de fonte por aqui: o DRE sempre a lê do CA ao vivo (já
-- reconcilia 100%, ver Passo 10). O cutover isola a única superfície de risco —
-- a despesa, que estamos migrando pro Jarvis — e a vira mês a mês, sem big-bang.
--
-- Puramente aditivo. Mesmo padrão de segurança do 0023: RLS ligada, SEM policies/
-- grants (só o service_role, via lib/financeiro, lê/escreve).

create table if not exists public.fin_dre_config (
  company_id uuid primary key references public.companies (id) on delete cascade,
  cutover_competencia text
    check (cutover_competencia is null or cutover_competencia ~ '^[0-9]{4}-[0-9]{2}$'),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

alter table public.fin_dre_config enable row level security;

-- Reusa o trigger de updated_at criado no 0023 (idempotente por drop+create).
drop trigger if exists fin_dre_config_set_updated_at on public.fin_dre_config;
create trigger fin_dre_config_set_updated_at
  before update on public.fin_dre_config
  for each row execute function public.fin_set_updated_at();

-- ============================================================================
-- ROLLBACK (rodar manualmente se precisar reverter):
--   drop table if exists public.fin_dre_config;
-- ============================================================================
