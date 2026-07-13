-- Fase 1 — Conversões & ROI (Meta Ads). Rodar no SQL Editor (convenção 0019).
-- Idempotente. Preenche o que hoje é null: conversões por dia/marca.
--
-- Origem: campo `actions`/`action_values` dos insights da Marketing API.
--  - leads         := action_type 'lead'
--  - conversations := 'onsite_conversion.messaging_conversation_started_7d'
--                     (conversas de WhatsApp/Direct iniciadas)
--  - purchases / conversion_value := 'purchase' (contagem e valor via pixel)
-- Escritos por lib/marketing/meta.ts; lidos/derivados (CPL, ROAS) por metrics.ts.

alter table public.marketing_daily_insights
  add column if not exists leads int,
  add column if not exists conversations int,
  add column if not exists purchases int,
  add column if not exists conversion_value numeric;
