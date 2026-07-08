-- Fase 2 — Memória evolutiva (pgvector). Rodar DEPOIS da 0001.

create extension if not exists vector with schema extensions;

-- Memórias destiladas das conversas (escopo por empresa) ---------------------
create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company_id() references public.companies (id) on delete cascade,
  source_conversation_id uuid references public.conversations (id) on delete set null,
  source_user_id uuid default auth.uid() references auth.users (id) on delete set null,
  kind text not null default 'fato',
  content text not null,
  confidence real not null default 0.5,
  embedding vector(768),
  created_at timestamptz not null default now()
);
alter table public.memories enable row level security;
create index if not exists memories_company_idx on public.memories (company_id);
create index if not exists memories_embedding_idx
  on public.memories using hnsw (embedding vector_cosine_ops);

-- RLS: memória COMPARTILHADA por empresa --------------------------------------
drop policy if exists "memories_select_company" on public.memories;
create policy "memories_select_company" on public.memories
  for select using (company_id = public.current_company_id());

drop policy if exists "memories_insert_company" on public.memories;
create policy "memories_insert_company" on public.memories
  for insert with check (company_id = public.current_company_id());

grant select, insert on public.memories to authenticated;

-- Busca por similaridade. SECURITY INVOKER (default) → a RLS acima filtra,
-- então só retorna memórias da empresa do usuário autenticado.
create or replace function public.match_memories(
  query_embedding vector(768),
  match_threshold float,
  match_count int
)
returns table (id uuid, content text, kind text, similarity float)
language sql
stable
set search_path = public, extensions
as $$
  select m.id, m.content, m.kind, 1 - (m.embedding <=> query_embedding) as similarity
  from public.memories m
  where m.embedding is not null
    and 1 - (m.embedding <=> query_embedding) > match_threshold
  order by m.embedding <=> query_embedding
  limit match_count;
$$;

revoke execute on function public.match_memories(vector, float, int) from anon;
grant execute on function public.match_memories(vector, float, int) to authenticated;
