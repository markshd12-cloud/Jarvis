-- 0036_mkt_metas.sql — Metas do painel de Marketing.
--
-- GLOBAL (sem company_id), como todo o módulo de marketing (ver 0019/0021): o
-- time trabalha as marcas de forma unificada e o acesso é pela permissão
-- `marketing`, não por empresa. RLS ligada sem policies — só service_role no
-- servidor, igual às demais tabelas do módulo.
--
-- MODELO
--
-- `metrica` + `alvo` + `competencia` identificam uma meta. `alvo` é texto porque
-- a chave muda conforme a métrica:
--   custo_resultado   -> label da marca do Meta Ads ("CPPEM Concursos")
--   seguidores_ig     -> account_id do Instagram (a marca "Everton" tem DUAS
--                        contas, e a meta é por PERFIL — decisão do requisitante)
--   seguidores_yt     -> channelId do YouTube (UC...)
--   receita_yt        -> channelId; ainda sem dado (nível B exige OAuth do dono)
--
-- `direcao` é OBRIGATÓRIA e não pode ser inferida da métrica:
--   'max' = TETO  (custo por resultado, CAC: quanto MENOR, melhor)
--   'min' = PISO  (seguidores, receita: quanto MAIOR, melhor)
-- Sem isso o indicador de desvio pinta verde onde deveria pintar vermelho — o
-- mesmo cuidado que o DRE toma com a convenção de sinal.
--
-- TUDO POR COMPETÊNCIA (fluxo), inclusive seguidores. Para um estoque como
-- seguidores a meta é o GANHO NO MÊS ("+2.000 em agosto"), não o saldo alvo com
-- data. Uniformiza a tela numa grade só por mês e evita dois tipos de meta
-- convivendo. Ver docs/marketing-metas.md.

create table if not exists public.mkt_metas (
  id uuid primary key default gen_random_uuid(),
  metrica text not null check (
    metrica in ('custo_resultado', 'seguidores_ig', 'seguidores_yt', 'cac', 'receita_yt')
  ),
  alvo text not null,
  competencia text not null check (competencia ~ '^\d{4}-\d{2}$'),
  valor numeric not null check (valor >= 0),
  direcao text not null check (direcao in ('max', 'min')),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Uma meta por (métrica, alvo, competência). É a chave do upsert da tela.
create unique index if not exists mkt_metas_uniq
  on public.mkt_metas (metrica, alvo, competencia);

create index if not exists mkt_metas_competencia_idx
  on public.mkt_metas (competencia);

alter table public.mkt_metas enable row level security;
-- Sem policies: lido/gravado via service_role no server, gated por can('marketing').

-- ============================================================================
-- ROLLBACK:
--   drop table if exists public.mkt_metas;
-- ============================================================================
