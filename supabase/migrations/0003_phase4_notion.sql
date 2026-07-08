-- Fase 4 — Notion: conexões (OAuth) + documentos/chunks vetoriais. Rodar após a 0002.

-- Conexões Notion — o token é sensível: RLS habilitada e SEM policies para
-- authenticated => só o service_role (servidor) acessa. O token nunca vai pra Data API.
create table if not exists public.notion_connections (
  company_id uuid primary key references public.companies (id) on delete cascade,
  access_token text not null,
  workspace_id text,
  workspace_name text,
  bot_id text,
  sync_cursor text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.notion_connections enable row level security;

-- Documentos externos (Notion) ------------------------------------------------
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  source text not null default 'notion',
  external_id text not null,
  title text,
  url text,
  last_edited_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id, source, external_id)
);
alter table public.documents enable row level security;
create index if not exists documents_company_idx on public.documents (company_id);

-- Chunks vetoriais dos documentos ---------------------------------------------
create table if not exists public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  content text not null,
  embedding vector(768),
  created_at timestamptz not null default now()
);
alter table public.document_chunks enable row level security;
create index if not exists document_chunks_company_idx on public.document_chunks (company_id);
create index if not exists document_chunks_doc_idx on public.document_chunks (document_id);
create index if not exists document_chunks_embedding_idx
  on public.document_chunks using hnsw (embedding vector_cosine_ops);

-- RLS: leitura por empresa (escrita só via service_role no sync) ---------------
drop policy if exists "documents_select_company" on public.documents;
create policy "documents_select_company" on public.documents
  for select using (company_id = public.current_company_id());

drop policy if exists "document_chunks_select_company" on public.document_chunks;
create policy "document_chunks_select_company" on public.document_chunks
  for select using (company_id = public.current_company_id());

grant select on public.documents to authenticated;
grant select on public.document_chunks to authenticated;

-- Busca por similaridade nos chunks (RLS aplica → só da empresa do usuário) ----
create or replace function public.match_documents(
  query_embedding vector(768),
  match_threshold float,
  match_count int
)
returns table (id uuid, document_id uuid, content text, similarity float)
language sql
stable
set search_path = public, extensions
as $$
  select c.id, c.document_id, c.content, 1 - (c.embedding <=> query_embedding) as similarity
  from public.document_chunks c
  where c.embedding is not null
    and 1 - (c.embedding <=> query_embedding) > match_threshold
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

revoke execute on function public.match_documents(vector, float, int) from anon;
grant execute on function public.match_documents(vector, float, int) to authenticated;
