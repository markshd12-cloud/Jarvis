-- Fase 4 (busca híbrida) — funde full-text em PT (lexical) + vetorial via RRF.
-- Resolve termos exatos/siglas (ex.: "ICP", "dores") que a busca só-vetorial soterrava.
-- Rodar após a 0004.

-- Índice full-text (português) sobre o conteúdo dos chunks — deixa a parte lexical rápida.
create index if not exists document_chunks_fts_idx
  on public.document_chunks
  using gin (to_tsvector('portuguese', content));

-- Busca híbrida com Reciprocal Rank Fusion (RRF).
-- SECURITY INVOKER (padrão) → a RLS por empresa em document_chunks/documents é aplicada.
-- Devolve também o TÍTULO do documento (contexto de origem para o modelo).
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
  with params as (
    -- Constrói uma tsquery em OU (recall alto) a partir da pergunta natural:
    -- tira pontuação, quebra em palavras (>=3 letras) e junta com ' | '.
    -- O ts_rank abaixo é quem premia quem casa MAIS termos. AND (websearch)
    -- zerava a recall em perguntas longas — por isso OU.
    select to_tsquery(
      'portuguese',
      coalesce(
        nullif(
          array_to_string(
            array(
              select tok
              from unnest(
                regexp_split_to_array(
                  lower(regexp_replace(query_text, '[^[:alnum:]áàâãéêíóôõúüç ]', ' ', 'g')),
                  '\s+'
                )
              ) as tok
              where length(tok) >= 3
            ),
            ' | '
          ),
          ''
        ),
        'zzzznadazzzz'  -- termo improvável → nenhum match quando a query é vazia
      )
    ) as q
  ),
  ft as (
    -- Ranking lexical por relevância (ts_rank_cd premia densidade/nº de termos).
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
