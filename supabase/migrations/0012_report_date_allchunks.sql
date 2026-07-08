-- FIX do backfill da 0011: ela lia só UM chunk por documento (distinct on ...
-- order by content), então relatórios longos (2+ chunks) cujo chunk com "Data:"
-- não ordenava primeiro ficavam com report_date NULL — de forma aleatória
-- (dependia do tamanho do relatório no dia). Aqui varremos TODOS os chunks.

update public.documents d
set report_date = sub.rd
from (
  select x.document_id, min(x.rd) as rd
  from (
    select dc.document_id,
      coalesce(
        to_date((regexp_match(dc.content, 'Data:\s*(\d{1,2}/\d{1,2}/\d{4})'))[1], 'DD/MM/YYYY'),
        to_date((regexp_match(dc.content, 'Data:\s*(\d{4}-\d{2}-\d{2})'))[1], 'YYYY-MM-DD')
      ) as rd
    from public.document_chunks dc
  ) x
  where x.rd is not null
  group by x.document_id
) sub
where d.id = sub.document_id
  and d.source = 'notion'
  and d.report_date is distinct from sub.rd;
