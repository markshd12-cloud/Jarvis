-- "Me dê o relatório do dia X" é uma consulta ESTRUTURADA (filtro por data),
-- não busca semântica. Com milhares de relatórios quase-idênticos (mesmo
-- template, mudando só a data) e o parser de full-text tratando "01/07/2026"
-- como UM token indivisível, nenhuma busca textual desempata data de forma
-- confiável. A solução robusta: extrair a data para uma COLUNA de verdade e
-- filtrar exato.

-- 1) Coluna estruturada da data do relatório (a data que a pessoa escreveu no
--    Notion, no campo "Data:"). Pode ser null para páginas que não são relatório.
alter table public.documents
  add column if not exists report_date date;

-- 2) Backfill a partir do conteúdo JÁ indexado (não precisa re-sincronizar o
--    Notion): o texto de cada relatório começa com "Data: DD/MM/AAAA" (ou o
--    ISO antigo "AAAA-MM-DD", como fallback). O conteúdo vive nos chunks
--    (documents.content é null para o Notion), então lemos do primeiro chunk.
update public.documents d
set report_date = sub.rd
from (
  select distinct on (dc.document_id)
    dc.document_id,
    coalesce(
      to_date((regexp_match(dc.content, 'Data:\s*(\d{1,2}/\d{1,2}/\d{4})'))[1], 'DD/MM/YYYY'),
      to_date((regexp_match(dc.content, 'Data:\s*(\d{4}-\d{2}-\d{2})'))[1], 'YYYY-MM-DD')
    ) as rd
  from public.document_chunks dc
  where dc.content ~ 'Data:\s*(\d{1,2}/\d{1,2}/\d{4}|\d{4}-\d{2}-\d{2})'
  order by dc.document_id, dc.content
) sub
where d.id = sub.document_id
  and d.source = 'notion'
  and sub.rd is not null;

-- 3) Índice para o filtro exato por empresa + data.
create index if not exists documents_report_date_idx
  on public.documents (company_id, source, report_date);
