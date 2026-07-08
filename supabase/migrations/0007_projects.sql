-- Projetos = "caixas de contextualização" (estilo ChatGPT/Claude): cada projeto
-- guarda instruções próprias e agrupa vários chats. Rode no Supabase: SQL Editor.

-- 1) Tabela de projetos -------------------------------------------------------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  company_id uuid not null default public.current_company_id() references public.companies (id),
  name text not null,
  -- Contexto/instruções injetadas em TODOS os chats do projeto.
  instructions text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.projects enable row level security;
create index if not exists projects_user_idx on public.projects (user_id, updated_at desc);
create index if not exists projects_company_idx on public.projects (company_id);

-- 2) Vínculo conversa -> projeto (nulo = chat solto, fora de projeto) ----------
alter table public.conversations
  add column if not exists project_id uuid references public.projects (id) on delete set null;
create index if not exists conversations_project_idx on public.conversations (project_id, updated_at desc);

-- 3) RLS: dono (owner-only), como em conversations ----------------------------
drop policy if exists "projects_select_own" on public.projects;
create policy "projects_select_own" on public.projects
  for select using (user_id = auth.uid());
drop policy if exists "projects_insert_own" on public.projects;
create policy "projects_insert_own" on public.projects
  for insert with check (user_id = auth.uid() and company_id = public.current_company_id());
drop policy if exists "projects_update_own" on public.projects;
create policy "projects_update_own" on public.projects
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "projects_delete_own" on public.projects;
create policy "projects_delete_own" on public.projects
  for delete using (user_id = auth.uid());

-- 4) Grants para a Data API (PostgREST) — RLS continua filtrando as linhas -----
grant select, insert, update, delete on public.projects to authenticated;
