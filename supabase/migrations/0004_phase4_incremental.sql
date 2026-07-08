-- Fase 4 (incremental) — pular conteúdo inalterado no sync do Notion. Rodar após a 0003.

alter table public.documents add column if not exists content_hash text;
alter table public.documents add column if not exists synced_at timestamptz;

-- Marco do sync incremental: maior last_edited_time já totalmente coberto.
alter table public.notion_connections add column if not exists last_edited_watermark timestamptz;

-- Acelera a leitura do "estado conhecido" por empresa durante o sync incremental.
create index if not exists documents_company_external_idx
  on public.documents (company_id, external_id);
