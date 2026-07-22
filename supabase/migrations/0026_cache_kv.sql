-- Cache chave-valor genérico, compartilhado e persistente. Rodar no SQL Editor.
--
-- Motivação: as leituras AO VIVO do Meta Ads detalhe/breakdowns (lib/marketing/
-- meta-detail.ts) fazem ~24 requests à Graph API por load frio. O cache em
-- memória (Map de processo) some a cada restart/redeploy e não é compartilhado
-- entre réplicas. Esta tabela guarda o resultado JSON com validade, servindo de
-- L2 atrás do cache em memória (L1) — ver lib/cache/kv.ts.
--
-- Genérico de propósito (não só marketing): `key` carrega o namespace
-- (ex.: 'meta-detail:all:2026-06-21:2026-07-21'). Valores são JSON serializável.
--
-- RLS habilitada e SEM policies => só o service_role (servidor) lê/escreve.
-- Espelha a segurança das demais tabelas do backend (marketing_*, fin_*).

create table if not exists public.cache_kv (
  key text primary key,
  value jsonb not null,
  -- Fronteira de FRESCOR (não de exclusão): passado isso o valor vira "stale" e
  -- dispara revalidação em background (SWR), mas continua servível até recomputar.
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.cache_kv enable row level security;
-- Sem policies de propósito: nenhum acesso via authenticated; só service_role.

-- Para uma varredura/limpeza eventual de entradas antigas (não há job hoje).
create index if not exists cache_kv_expires_at_idx on public.cache_kv (expires_at);
