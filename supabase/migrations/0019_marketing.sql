-- Marketing — conexões e métricas GLOBAIS do workspace. Rodar no SQL Editor.
--
-- Diferente de contaazul_connections (0016), NÃO há company_id: o marketing é
-- trabalhado de forma unificada para todas as marcas (Colégio, CPPEM, Everton
-- Mota). Qualquer usuário com a permissão "marketing" vê o painel inteiro,
-- independentemente da empresa dele. A conexão é um singleton por provedor.
--
-- Token sensível (System User da Meta): RLS habilitada e SEM policies para
-- authenticated => só o service_role (servidor) lê/escreve. O token nunca vai
-- pela Data API. Espelha a segurança de notion_connections (0003) e
-- contaazul_connections (0016), sem o escopo por empresa.
--
-- Dados estruturados → DASHBOARD (não RAG).

-- 1) Conexão por provedor: 'meta_ads' (System User token) e 'ga4' (usa a
--    service account do Vertex; access_token fica null, guardamos só o property).
create table if not exists public.marketing_connections (
  provider text primary key,              -- 'meta_ads' | 'ga4'
  access_token text,                      -- Meta: System User token (não expira). GA4: null.
  account_id text,                        -- Meta: ad account (act_123...). GA4: properties/123.
  account_name text,                      -- Apelido exibido na UI de Conexões.
  scope text,
  expires_at timestamptz,                 -- System User token não expira => null.
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.marketing_connections enable row level security;
-- Sem policies de propósito: nenhum acesso via authenticated; só service_role.

-- 2) Métricas diárias agregadas (estruturadas). Globais (sem company_id).
--    `brand` separa as marcas (Colégio/CPPEM/Everton Mota); null = agregado geral
--    da conta ("dados gerais", que é o que o usuário pediu como principal).
create table if not exists public.marketing_daily_insights (
  id uuid primary key default gen_random_uuid(),
  provider text not null,                 -- 'meta_ads' | 'ga4'
  date date not null,
  brand text,                             -- null = agregado geral da conta
  spend numeric,
  impressions bigint,
  clicks bigint,
  reach bigint,
  conversions numeric,
  -- Métricas cruas sem coluna dedicada (ctr, cpc, cpm, sessions GA4, etc.).
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  -- Upsert idempotente por dia/marca no sync.
  unique (provider, date, brand)
);

alter table public.marketing_daily_insights enable row level security;
-- Sem policies: o dashboard lê via service_role no server (gated por can('marketing')).

create index if not exists marketing_daily_insights_provider_date_idx
  on public.marketing_daily_insights (provider, date desc);