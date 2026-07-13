-- Marketing — métricas ORGÂNICAS (Instagram agora; Facebook Page na Fase 4).
-- Rodar no SQL Editor (convenção 0019/0020). Idempotente. GLOBAL: sem company_id;
-- acesso pelo servidor via service_role, gated por can('marketing').

-- 1) Snapshot diário por conta orgânica. `followers` é o total no dia (tirado do
--    nó da conta a cada sync) — a série constrói a curva de crescimento daqui pra
--    frente (a Graph API não dá histórico de followers). Demais campos são
--    insights do dia; podem faltar conforme a versão/permissão (tolerado no sync).
create table if not exists public.social_daily_insights (
  provider text not null,               -- 'instagram' | 'facebook_page'
  account_id text not null,             -- IG user id / Page id
  brand text not null,
  date date not null,
  followers int,
  reach int,
  views int,
  profile_views int,
  website_clicks int,
  accounts_engaged int,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (provider, account_id, date)
);

alter table public.social_daily_insights enable row level security;
-- Sem policies: só service_role (servidor).

create index if not exists social_daily_insights_provider_brand_date_idx
  on public.social_daily_insights (provider, brand, date desc);

-- 2) Métricas por conteúdo (post/reel/story). PK por mídia (upsert idempotente).
create table if not exists public.social_media_insights (
  provider text not null,
  media_id text not null,
  account_id text,
  brand text not null,
  media_type text,                      -- IMAGE | VIDEO | CAROUSEL_ALBUM
  media_product_type text,              -- FEED | REELS | STORY
  permalink text,
  caption text,
  reach int,
  views int,
  likes int,
  comments int,
  saved int,
  shares int,
  metrics jsonb not null default '{}'::jsonb,
  posted_at timestamptz,
  synced_at timestamptz not null default now(),
  primary key (provider, media_id)
);

alter table public.social_media_insights enable row level security;
-- Sem policies: só service_role (servidor).

create index if not exists social_media_insights_brand_posted_idx
  on public.social_media_insights (brand, posted_at desc);
