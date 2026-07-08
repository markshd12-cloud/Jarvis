-- Fase 1 — Papéis (superadmin/admin/member) + endurecimento de RLS.
-- Base para multi-empresa com vários usuários por empresa. Rodar no SQL Editor.
--
-- IMPORTANTE (defesa em profundidade, fora do SQL): nas configurações de Auth do
-- Supabase, DESATIVE "Allow new users to sign up". O sistema é somente-convite —
-- usuários nascem via server action (service_role), nunca por auto-cadastro.

-- 1) Colunas: papel do usuário + email denormalizado (para listar sem Auth API) --
alter table public.profiles
  add column if not exists role text not null default 'member',
  add column if not exists email text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_role_check'
  ) then
    alter table public.profiles
      add constraint profiles_role_check
      check (role in ('superadmin', 'admin', 'member'));
  end if;
end $$;

-- 2) Backfill — ANTES de criar o guard (senão ele bloquearia estas escritas) -----
--    Preenche email a partir do auth.users e promove a conta administradora.
--    Em uma RE-execução o guard já existe: solte-o aqui para não bloquear o
--    backfill (a sessão do SQL Editor não é service_role). Ele é recriado abaixo.
drop trigger if exists profiles_guard_privileged on public.profiles;

update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id and p.email is distinct from u.email;

update public.profiles p
set role = 'superadmin'
from auth.users u
where u.id = p.id and lower(u.email) = 'administrador@cppem.com.br';

-- 3) Helper de papel (SECURITY DEFINER, mesmo padrão de current_company_id) ------
create or replace function public.is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'superadmin'
  );
$$;
revoke execute on function public.is_superadmin() from anon;

-- 4) Guard: role/company_id/email só mudam pelo SERVIDOR (service_role) ----------
--    Toda mudança privilegiada passa por server action autorizada. Assim, mesmo
--    com a policy de update-self, o usuário NÃO consegue se auto-promover.
create or replace function public.profiles_guard_privileged()
returns trigger
language plpgsql
as $$
begin
  if (
    new.role is distinct from old.role
    or new.company_id is distinct from old.company_id
    or new.email is distinct from old.email
  ) and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception
      'Alteração de role/company_id/email só é permitida pelo servidor';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_privileged on public.profiles;
create trigger profiles_guard_privileged
  before update on public.profiles
  for each row execute function public.profiles_guard_privileged();

-- 5) Trigger de novo usuário: cria o perfil com papel PADRÃO (member) + email. ---
--    NÃO lê papel/empresa de metadata (que é manipulável no signup). A empresa e
--    o cargo do convidado são definidos pela server action (service_role) da Fase 3.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, company_id, email)
  values (
    new.id,
    (select id from public.companies order by created_at limit 1),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- 6) RLS -------------------------------------------------------------------------

-- companies: superadmin vê/gerencia todas; demais só a própria.
drop policy if exists "companies_select_own" on public.companies;
create policy "companies_select_own" on public.companies
  for select using (id = public.current_company_id() or public.is_superadmin());

drop policy if exists "companies_insert_superadmin" on public.companies;
create policy "companies_insert_superadmin" on public.companies
  for insert with check (public.is_superadmin());

drop policy if exists "companies_update_superadmin" on public.companies;
create policy "companies_update_superadmin" on public.companies
  for update using (public.is_superadmin()) with check (public.is_superadmin());

-- profiles: ver perfis da própria empresa (superadmin vê todos). O update-self
-- continua, agora protegido pelo guard acima contra escalonamento.
drop policy if exists "profiles_select_company" on public.profiles;
create policy "profiles_select_company" on public.profiles
  for select using (company_id = public.current_company_id() or public.is_superadmin());

-- 7) Grants (RLS continua filtrando as linhas) -----------------------------------
grant insert, update on public.companies to authenticated;
