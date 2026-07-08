-- Fase 3 — Roles customizáveis por empresa + matriz de permissões (ver/editar/gerenciar).
-- Base para a área "Empresas" (superadmin) e a matriz de checkbox estilo Evo-Nexus.
-- Rodar no SQL Editor. Escrita de roles/vínculo é SEMPRE via service_role (server
-- actions autorizadas) — a RLS só libera LEITURA para authenticated.

-- 1) Tabela de roles (por empresa) -----------------------------------------------
create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  description text not null default '',
  -- { "chat": ["ver"], "conhecimento": ["ver","editar"] } — recurso -> ações
  permissions jsonb not null default '{}'::jsonb,
  is_builtin boolean not null default false,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);
alter table public.roles enable row level security;
create index if not exists roles_company_idx on public.roles (company_id);

-- 2) Vínculo do perfil com a role (a role carrega as permissões de feature) -------
alter table public.profiles
  add column if not exists role_id uuid references public.roles (id) on delete set null;

-- 3) Seed: cada empresa ganha as built-in "Administrador" e "Membro" --------------
--    Administrador = acesso total; Membro = só "ver" nos módulos de uso.
insert into public.roles (company_id, name, description, permissions, is_builtin)
select
  c.id,
  'Administrador',
  'Acesso total à empresa (gerencia usuários e roles).',
  '{"dashboard":["ver"],"chat":["ver"],"conhecimento":["ver","editar","gerenciar"],"personalizar":["ver","editar","gerenciar"],"usuarios":["ver","gerenciar"]}'::jsonb,
  true
from public.companies c
on conflict (company_id, name) do nothing;

insert into public.roles (company_id, name, description, permissions, is_builtin)
select
  c.id,
  'Membro',
  'Acesso de uso ao Jarvis.',
  '{"dashboard":["ver"],"chat":["ver"],"conhecimento":["ver"],"personalizar":["ver"]}'::jsonb,
  true
from public.companies c
on conflict (company_id, name) do nothing;

-- 4) Backfill role_id — ANTES de o guard passar a vigiar role_id (senão bloqueia). -
--    superadmin/admin -> Administrador; member -> Membro (da própria empresa).
update public.profiles p
set role_id = r.id
from public.roles r
where r.company_id = p.company_id
  and r.name = case when p.role in ('superadmin', 'admin') then 'Administrador' else 'Membro' end
  and p.role_id is null;

-- 5) Endurecer o guard: role_id também só muda pelo servidor (service_role). -------
--    Impede um member de se auto-atribuir a role Administrador via update-self.
create or replace function public.profiles_guard_privileged()
returns trigger
language plpgsql
as $$
begin
  if (
    new.role is distinct from old.role
    or new.company_id is distinct from old.company_id
    or new.email is distinct from old.email
    or new.role_id is distinct from old.role_id
  ) and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception
      'Alteração de role/company_id/email/role_id só é permitida pelo servidor';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_privileged on public.profiles;
create trigger profiles_guard_privileged
  before update on public.profiles
  for each row execute function public.profiles_guard_privileged();

-- 6) RLS: leitura das roles da própria empresa (superadmin vê todas). Escrita só
--    via service_role (sem policy de insert/update/delete = authenticated não grava).
drop policy if exists "roles_select_company" on public.roles;
create policy "roles_select_company" on public.roles
  for select using (company_id = public.current_company_id() or public.is_superadmin());

grant select on public.roles to authenticated;
