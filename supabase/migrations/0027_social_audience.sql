-- Marketing — audiência orgânica do Instagram: demografia dos seguidores e
-- horários com mais gente online. Rodar no SQL Editor (convenção 0019+).
-- Idempotente. GLOBAL: sem company_id; acesso pelo servidor via service_role.
--
-- Snapshot (não série densa): a demografia muda devagar, então guardamos por dia
-- de captura e o leitor usa sempre o snapshot mais recente por conta. Formato
-- longo (uma linha por segmento) cobre todos os breakdowns numa tabela só:
--   breakdown='age'     segment='25-34'          value=1234
--   breakdown='gender'  segment='F'              value=5678
--   breakdown='city'    segment='São Paulo, SP'  value=910
--   breakdown='country' segment='BR'             value=1112
--   breakdown='hour'    segment='14'             value=88   (online_followers)
create table if not exists public.social_audience (
  provider text not null,               -- 'instagram'
  account_id text not null,             -- IG user id
  brand text not null,
  breakdown text not null,              -- 'age' | 'gender' | 'city' | 'country' | 'hour'
  segment text not null,                -- valor da dimensão
  value numeric not null,
  captured_on date not null,            -- dia do snapshot
  created_at timestamptz not null default now(),
  primary key (provider, account_id, breakdown, segment, captured_on)
);

alter table public.social_audience enable row level security;
-- Sem policies de propósito: só o service_role (servidor) lê/escreve.

create index if not exists social_audience_brand_breakdown_idx
  on public.social_audience (provider, brand, breakdown, captured_on desc);
