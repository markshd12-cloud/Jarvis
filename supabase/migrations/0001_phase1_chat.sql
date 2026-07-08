-- Fase 1 — Base multi-tenant (por empresa) + conversas/mensagens com RLS.
-- Rode no Supabase: SQL Editor (colar e executar) ou via CLI.

-- 1) Empresas ----------------------------------------------------------------
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);
alter table public.companies enable row level security;

-- 2) Perfis (usuário -> empresa) ---------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  company_id uuid references public.companies (id) on delete set null,
  full_name text,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create index if not exists profiles_company_id_idx on public.profiles (company_id);

-- 3) Empresa do usuário atual (para uso nas policies).
--    SECURITY DEFINER para não recursar na RLS de profiles.
create or replace function public.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select company_id from public.profiles where id = auth.uid();
$$;
revoke execute on function public.current_company_id() from anon;

-- 4) Empresa padrão (CPPEM) + backfill de perfis dos usuários já existentes ---
insert into public.companies (name)
select 'CPPEM'
where not exists (select 1 from public.companies);

insert into public.profiles (id, company_id)
select u.id, (select id from public.companies order by created_at limit 1)
from auth.users u
on conflict (id) do nothing;

-- 5) Trigger: cria perfil automaticamente para novos usuários ----------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, company_id)
  values (new.id, (select id from public.companies order by created_at limit 1))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 6) Conversas ----------------------------------------------------------------
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  company_id uuid not null default public.current_company_id() references public.companies (id),
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.conversations enable row level security;
create index if not exists conversations_user_idx on public.conversations (user_id, updated_at desc);
create index if not exists conversations_company_idx on public.conversations (company_id);

-- 7) Mensagens (id = id da mensagem do AI SDK) --------------------------------
create table if not exists public.messages (
  id text primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null default '',
  created_at timestamptz not null default now()
);
alter table public.messages enable row level security;
create index if not exists messages_conversation_idx on public.messages (conversation_id, created_at);

-- 8) RLS policies -------------------------------------------------------------

-- companies: ver apenas a própria empresa
drop policy if exists "companies_select_own" on public.companies;
create policy "companies_select_own" on public.companies
  for select using (id = public.current_company_id());

-- profiles: ver perfis da própria empresa; atualizar só o próprio
drop policy if exists "profiles_select_company" on public.profiles;
create policy "profiles_select_company" on public.profiles
  for select using (company_id = public.current_company_id());
drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- conversations: dono (owner-only); empresa preenchida por default/check
drop policy if exists "conversations_select_own" on public.conversations;
create policy "conversations_select_own" on public.conversations
  for select using (user_id = auth.uid());
drop policy if exists "conversations_insert_own" on public.conversations;
create policy "conversations_insert_own" on public.conversations
  for insert with check (user_id = auth.uid() and company_id = public.current_company_id());
drop policy if exists "conversations_update_own" on public.conversations;
create policy "conversations_update_own" on public.conversations
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "conversations_delete_own" on public.conversations;
create policy "conversations_delete_own" on public.conversations
  for delete using (user_id = auth.uid());

-- messages: acesso via dono da conversa
drop policy if exists "messages_select_own" on public.messages;
create policy "messages_select_own" on public.messages
  for select using (exists (
    select 1 from public.conversations c
    where c.id = conversation_id and c.user_id = auth.uid()
  ));
drop policy if exists "messages_insert_own" on public.messages;
create policy "messages_insert_own" on public.messages
  for insert with check (exists (
    select 1 from public.conversations c
    where c.id = conversation_id and c.user_id = auth.uid()
  ));

-- 9) Grants para a Data API (PostgREST) — RLS continua filtrando as linhas ----
grant select on public.companies to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.conversations to authenticated;
grant select, insert on public.messages to authenticated;
