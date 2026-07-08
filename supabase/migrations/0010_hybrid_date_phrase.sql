-- Com milhares de documentos quase-idênticos (ex.: relatórios diários do mesmo
-- modelo/template, diferindo só na data), o OR de tokens soltos não desempata
-- direito: "01" e "07" aparecendo em qualquer lugar do texto não distingue
-- "01/07" de "07/01" nem de um documento que só por acaso tem os dois números
-- em frases diferentes. Aqui reconhecemos padrões "DD/MM" ou "DD-MM" na
-- pergunta e viram uma FRASE (os dois números ADJACENTES no texto, na mesma
-- ordem) — isso ranqueia muito mais alto o documento que tem a data exata.

create or replace function public.hybrid_search_documents(
  query_text text,
  query_embedding vector(768),
  match_count int default 8,
  rrf_k int default 50
)
returns table (id uuid, document_id uuid, content text, title text, url text, score float)
language sql
stable
set search_path = public, extensions
as $$
  with terms as (
    select
      -- palavras com 3+ letras OU números de qualquer tamanho (datas soltas).
      coalesce(
        array_to_string(
          array(
            select tok
            from unnest(
              regexp_split_to_array(
                lower(regexp_replace(query_text, '[^[:alnum:]áàâãéêíóôõúüç ]', ' ', 'g')),
                '\s+'
              )
            ) as tok
            where tok <> '' and (length(tok) >= 3 or tok ~ '^[0-9]+$')
          ),
          ' | '
        ),
        ''
      ) as word_terms,
      -- "01/07", "1-7" etc. → frase "01<->07" (zero-padded pra bater com o
      -- formato indexado "DD/MM/AAAA"), premiando a data EXATA e na ordem certa.
      coalesce(
        (
          select string_agg(
            '(' || lpad(m[1], 2, '0') || '<->' || lpad(m[2], 2, '0') || ')',
            ' | '
          )
          from regexp_matches(query_text, '(\d{1,2})\s*[/-]\s*(\d{1,2})(?!\d)', 'g') as m
        ),
        ''
      ) as date_terms
  ),
  params as (
    select to_tsquery(
      'portuguese',
      coalesce(
        nullif(
          case
            when word_terms <> '' and date_terms <> '' then word_terms || ' | ' || date_terms
            when date_terms <> '' then date_terms
            else word_terms
          end,
          ''
        ),
        'zzzznadazzzz'  -- termo improvável → nenhum match quando a query é vazia
      )
    ) as q
    from terms
  ),
  ft as (
    -- Ranking lexical por relevância (ts_rank_cd premia densidade/proximidade —
    -- frases adjacentes rankeiam mais alto que termos soltos e distantes).
    select c.id,
      row_number() over (
        order by ts_rank_cd(to_tsvector('portuguese', c.content), params.q) desc
      ) as rank_ix
    from public.document_chunks c, params
    where to_tsvector('portuguese', c.content) @@ params.q
    limit greatest(match_count, 1) * 4
  ),
  sem as (
    -- Ranking semântico (usa o índice HNSW).
    select c.id,
      row_number() over (order by c.embedding <=> query_embedding) as rank_ix
    from public.document_chunks c
    where c.embedding is not null
    limit greatest(match_count, 1) * 4
  )
  select
    c.id,
    c.document_id,
    c.content,
    d.title,
    d.url,
    coalesce(1.0 / (rrf_k + ft.rank_ix), 0.0)
      + coalesce(1.0 / (rrf_k + sem.rank_ix), 0.0) as score
  from ft
  full outer join sem on ft.id = sem.id
  join public.document_chunks c on c.id = coalesce(ft.id, sem.id)
  join public.documents d on d.id = c.document_id
  order by score desc
  limit match_count;
$$;

revoke execute on function public.hybrid_search_documents(text, vector, int, int) from anon;
grant execute on function public.hybrid_search_documents(text, vector, int, int) to authenticated;
