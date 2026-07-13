-- Marketing — índice para consultas por período/marca + RPC de agregação.
-- Rodar no SQL Editor (mesmo fluxo manual de 0019). Idempotente.
--
-- Contexto: metrics.ts consulta marketing_daily_insights por intervalo de datas,
-- ora sem marca (dashboard/chat: soma todas), ora filtrando uma marca (filtro do
-- dashboard, passo 3). O 0019 já tem (provider, date desc) e o unique
-- (provider, date, brand) — ótimos para "provider + faixa de data", mas não para
-- "provider + UMA marca + faixa de data" (brand fica depois de date na chave).

-- 1) Índice para o filtro por marca: provider e brand como igualdade, date como
--    range/ordenação. Cobre getMetaMetrics({ ..., brand }) e getMetaDaily.
create index if not exists marketing_daily_insights_provider_brand_date_idx
  on public.marketing_daily_insights (provider, brand, date desc);

-- 2) RPC OPCIONAL de agregação (boa prática Supabase): faz SUM ... GROUP BY no
--    Postgres em vez de somar no Node. NÃO está em uso — a app segue agregando em
--    metrics.ts (volume atual é pequeno: ~4 marcas × poucos meses). Fica pronta
--    para quando o volume crescer; basta trocar a leitura por um .rpc().
--
--    ctr/cpc/cpm continuam derivados das somas na app (não faz sentido somá-los).
--    O agregado geral (brand = null) é a soma destas linhas, feita pelo chamador.
create or replace function public.meta_metrics(p_since date, p_until date)
returns table (
  brand text,
  spend numeric,
  impressions bigint,
  clicks bigint,
  reach bigint
)
language sql
stable
as $$
  select
    i.brand,
    coalesce(sum(i.spend), 0)::numeric        as spend,
    coalesce(sum(i.impressions), 0)::bigint   as impressions,
    coalesce(sum(i.clicks), 0)::bigint        as clicks,
    coalesce(sum(i.reach), 0)::bigint         as reach
  from public.marketing_daily_insights i
  where i.provider = 'meta_ads'
    and i.brand is not null
    and i.date >= p_since
    and i.date <= p_until
  group by i.brand
  order by coalesce(sum(i.spend), 0) desc;
$$;

-- Segurança: só o service_role (servidor, atrás do gate can('marketing')) executa.
-- Por padrão o Postgres concede EXECUTE a PUBLIC; revogamos e concedemos apenas
-- ao service_role — senão qualquer usuário autenticado leria métricas contornando
-- a permissão. O grant explícito é obrigatório: após revogar PUBLIC, o próprio
-- service_role (usado pela app via a service key) ficaria sem acesso.
revoke all on function public.meta_metrics(date, date) from public, anon, authenticated;
grant execute on function public.meta_metrics(date, date) to service_role;
