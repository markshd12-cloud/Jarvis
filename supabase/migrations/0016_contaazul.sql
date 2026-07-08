-- Conta Azul — conexão OAuth por empresa. Rodar no SQL Editor do Supabase.
--
-- O token (access/refresh) é sensível: RLS habilitada e SEM policies para
-- authenticated => só o service_role (servidor) lê/escreve. O token nunca vai
-- pela Data API. Espelha o padrão de `notion_connections` (0003).
--
-- Diferente do Notion, os dados da Conta Azul são estruturados e alimentam o
-- DASHBOARD (pessoas, vendas, financeiro), não o RAG.

create table if not exists public.contaazul_connections (
  company_id uuid primary key references public.companies (id) on delete cascade,
  access_token text not null,
  refresh_token text,
  token_type text,
  -- Instante de expiração do access_token (para renovar via refresh_token).
  expires_at timestamptz,
  scope text,
  -- Apelido/identificação da conta na Conta Azul, quando disponível.
  account_name text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.contaazul_connections enable row level security;
-- Sem policies de propósito: nenhum acesso via authenticated; só service_role.
