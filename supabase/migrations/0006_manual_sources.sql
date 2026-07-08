-- Fontes estáticas inseridas à mão (página "Personalizar").
-- Reaproveitam documents/document_chunks com source='manual'; guardamos o TEXTO
-- bruto em documents.content para permitir edição posterior. Rodar após a 0005.

alter table public.documents add column if not exists content text;

-- Acelera a listagem/edição das fontes manuais por empresa.
create index if not exists documents_company_source_idx
  on public.documents (company_id, source);
