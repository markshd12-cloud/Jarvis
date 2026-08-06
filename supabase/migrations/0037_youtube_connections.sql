-- 0037_youtube_connections.sql — OAuth do dono do canal (YouTube Nível B).
--
-- Por que uma tabela nova, e não `marketing_connections` (0019):
--   1. lá `provider` é PRIMARY KEY → uma linha por provedor. Aqui precisamos de
--      UMA LINHA POR CANAL: cada canal do YouTube exige a sua própria
--      autorização, e o token é escopado a ele.
--   2. lá não existe `refresh_token` — o Meta usa System User token, que não
--      expira. O Google expira o access_token em ~1h e a renovação é obrigatória.
--
-- GLOBAL (sem company_id), como todo o módulo de marketing. RLS ligada sem
-- policies: só service_role no servidor. Espelha `contaazul_connections` (0016).
--
-- O que isto destrava (YouTube Analytics API):
--   - `subscribersGained`/`subscribersLost` EXATOS. A Data API pública arredonda
--     inscritos para 3 dígitos significativos acima de 1.000 — inclusive para o
--     dono —, e por isso a meta de inscritos ficou de fora (o CPPEM marca 387.000
--     há semanas). Ver docs/marketing-metas.md.
--   - watch time, retenção e receita do canal.

create table if not exists public.youtube_connections (
  -- Channel ID (UC...). Chave natural: uma autorização por canal.
  channel_id text primary key,
  channel_title text,
  access_token text not null,
  -- ⚠️ O Google só devolve `refresh_token` na PRIMEIRA autorização de cada
  -- conta, a menos que se peça `prompt=consent` + `access_type=offline`. Sem ele
  -- a conexão morre em 1 hora e não há como renovar sem o usuário voltar.
  refresh_token text,
  token_type text,
  -- Instante de expiração do access_token (renovar antes de usar).
  expires_at timestamptz,
  scope text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.youtube_connections enable row level security;
-- Sem policies de propósito: nenhum acesso via authenticated; só service_role.

-- ============================================================================
-- ROLLBACK:
--   drop table if exists public.youtube_connections;
-- ============================================================================
