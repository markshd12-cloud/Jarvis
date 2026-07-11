-- Escopo/visibilidade das fontes manuais (página "Personalizar"). Rodar após a 0016.
-- Idempotente: pode rodar mais de uma vez sem quebrar.
--
-- Modelo do alcance de uma fonte manual:
--   • pessoal ("única")  -> owner_id preenchido            -> só o autor vê;
--   • empresas           -> vínculos em document_companies -> cada empresa marcada vê.
-- NÃO há "global": para valer em todas, marca-se todas as empresas (empresas
-- criadas depois NÃO herdam). Fontes Notion seguem com company_id único (inalteradas).
--
-- A busca do RAG (hybrid_search_documents / match_documents) é SECURITY INVOKER,
-- então basta a RLS de SELECT abaixo — o retrieval passa a incluir as fontes
-- pessoais do usuário e as das empresas dele. Escritas continuam só via
-- service_role (server actions), que aplicam a regra por papel.

-- 1) company_id aceita NULL (fonte manual passa a se apoiar no vínculo) ---------
alter table public.documents        alter column company_id drop not null;
alter table public.document_chunks   alter column company_id drop not null;

-- 2) Dono da fonte (fonte pessoal). Null = fonte de empresa(s) ------------------
alter table public.documents
  add column if not exists owner_id uuid references auth.users (id) on delete cascade;
alter table public.document_chunks
  add column if not exists owner_id uuid references auth.users (id) on delete cascade;
create index if not exists documents_owner_idx      on public.documents (owner_id);
create index if not exists document_chunks_owner_idx on public.document_chunks (owner_id);

-- 3) Vínculo fonte <-> empresas (uma fonte pode valer para várias) -------------
create table if not exists public.document_companies (
  document_id uuid not null references public.documents (id) on delete cascade,
  company_id  uuid not null references public.companies (id) on delete cascade,
  primary key (document_id, company_id)
);
create index if not exists document_companies_company_idx
  on public.document_companies (company_id);

alter table public.document_companies enable row level security;
drop policy if exists "document_companies_select" on public.document_companies;
create policy "document_companies_select" on public.document_companies
  for select using (
    company_id = public.current_company_id() or public.is_superadmin()
  );
grant select on public.document_companies to authenticated;

-- 4) Backfill: fontes manuais existentes (empresa única) viram vínculo ----------
insert into public.document_companies (document_id, company_id)
  select id, company_id from public.documents
  where source = 'manual' and owner_id is null and company_id is not null
  on conflict do nothing;

update public.documents set company_id = null
  where source = 'manual' and owner_id is null and company_id is not null;

update public.document_chunks c set company_id = null
  from public.documents d
  where c.document_id = d.id and d.source = 'manual' and c.owner_id is null;

-- 5) RLS de leitura: pessoal (minha) OU empresa única (Notion/legado) OU vínculo
drop policy if exists "documents_select_company" on public.documents;
drop policy if exists "documents_select_scope"   on public.documents;
create policy "documents_select_scope" on public.documents
  for select using (
    owner_id = auth.uid()
    or (owner_id is null and company_id = public.current_company_id())
    or (owner_id is null and exists (
      select 1 from public.document_companies dc
      where dc.document_id = documents.id
        and dc.company_id = public.current_company_id()
    ))
  );

drop policy if exists "document_chunks_select_company" on public.document_chunks;
drop policy if exists "document_chunks_select_scope"   on public.document_chunks;
create policy "document_chunks_select_scope" on public.document_chunks
  for select using (
    owner_id = auth.uid()
    or (owner_id is null and company_id = public.current_company_id())
    or (owner_id is null and exists (
      select 1 from public.document_companies dc
      where dc.document_id = document_chunks.document_id
        and dc.company_id = public.current_company_id()
    ))
  );
