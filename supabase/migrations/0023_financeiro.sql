-- Sistema Financeiro Gerencial (multi-BU) — schema base. Rodar no SQL Editor do
-- Supabase, DEPOIS de 0022. Ver docs/financeiro-PRD.md §5 (modelo) e §9 Passo 1.
--
-- Segurança (foto interna da empresa, admin-only): RLS habilitada em TODAS as
-- tabelas e SEM policies/grants para `authenticated` — só o service_role
-- (servidor, via lib/financeiro) lê/escreve. Mesmo padrão de
-- contaazul_connections (0016). Nada aqui vai pela Data API/browser.
--
-- Convenções (padrão do projeto): id uuid, company_id -> companies (sem default
-- current_company_id(), pois quem escreve é o service_role, que não tem
-- auth.uid()), created_at/updated_at, created_by/updated_by (nullable, setados
-- pela app). Dinheiro em numeric(14,2), NUNCA float. Competência/vencimento em
-- `date` (sem hora), pra casar com o Conta Azul. Enums como text + check.
-- Dimensões (categoria/BU/centro) são `on delete restrict`: não se apaga uma
-- dimensão com lançamento pendurado (inativa-se via flag `ativo`).

-- 0) Helper: trigger de updated_at reutilizado por todas as tabelas -----------
create or replace function public.fin_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 1) business_units — a BU (unidade/empresa interna: CPPEM/Colégio/Unicive) ---
--    Dimensão nossa, nova, que o CA não carrega. As 3 BUs são semeadas no Passo 2.
create table if not exists public.business_units (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  nome text not null,
  slug text not null,
  cnpj text,
  cor text,                         -- hex p/ charts (ex. '#00FF01')
  ativo boolean not null default true,
  ordem int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  unique (company_id, slug)
);
create index if not exists business_units_company_idx on public.business_units (company_id, ordem);

-- 2) fin_categorias — hierárquica (pai/filho/neto) + estrutura DRE -----------
create table if not exists public.fin_categorias (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  parent_id uuid references public.fin_categorias (id) on delete restrict,
  codigo text,                      -- '1.8', '03.2' (do CA)
  nome text not null,
  tipo text not null check (tipo in ('receita','deducao','custo','despesa','imposto','financeira')),
  grupo_dre text check (grupo_dre is null or grupo_dre in ('01','02','03','04','05','06','07','08')),
  natureza text check (natureza is null or natureza in ('fixa','variavel')),
  bu_id uuid references public.business_units (id) on delete restrict,   -- RECEITA: de-para BU
  ca_categoria_id text,             -- de-para com o CA (dedup no seed/snapshot)
  ativo boolean not null default true,
  ordem int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  check (parent_id is null or parent_id <> id),   -- anti auto-referência (ciclo profundo: app, Passo 4)
  unique (company_id, ca_categoria_id)            -- idempotência do seed (nulls distintos ok)
);
create index if not exists fin_categorias_company_idx on public.fin_categorias (company_id, ordem);
create index if not exists fin_categorias_parent_idx on public.fin_categorias (parent_id);
create index if not exists fin_categorias_bu_idx on public.fin_categorias (bu_id);
create index if not exists fin_categorias_grupo_idx on public.fin_categorias (grupo_dre);

-- 3) fin_centros_custo -------------------------------------------------------
create table if not exists public.fin_centros_custo (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  codigo text,
  nome text not null,
  ca_centro_id text,                -- de-para com o CA (dedup no seed)
  ativo boolean not null default true,
  ordem int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  unique (company_id, ca_centro_id)
);
create index if not exists fin_centros_custo_company_idx on public.fin_centros_custo (company_id, ordem);

-- 4) fin_colaboradores — colaboradores & fornecedores (pessoas internas) -----
--    PII (chave pix, conta): protegida por RLS service_role-only. Nunca vai ao browser.
create table if not exists public.fin_colaboradores (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  nome text not null,
  cpf_cnpj text,
  tipo text not null check (tipo in ('colaborador','fornecedor')),
  banco text,
  agencia text,
  conta text,
  chave_pix text,
  cargo text,
  salario_base numeric(14,2) check (salario_base is null or salario_base >= 0),
  bu_id uuid references public.business_units (id) on delete restrict,
  ca_pessoa_id text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null
);
create index if not exists fin_colaboradores_company_idx on public.fin_colaboradores (company_id, tipo, ativo);

-- 5) fin_recorrencias — gera parcelas mensais (aluguel, salário…) ------------
--    Criada antes de fin_despesas porque fin_despesas.recorrencia_id a referencia.
create table if not exists public.fin_recorrencias (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  descricao text not null,
  categoria_id uuid not null references public.fin_categorias (id) on delete restrict,
  bu_id uuid not null references public.business_units (id) on delete restrict,
  colaborador_id uuid references public.fin_colaboradores (id) on delete set null,
  valor_previsto numeric(14,2) not null check (valor_previsto >= 0),
  dia_vencimento int not null check (dia_vencimento between 1 and 31),
  periodicidade text not null check (periodicidade in ('mensal','anual')),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null
);
create index if not exists fin_recorrencias_company_idx on public.fin_recorrencias (company_id, ativo);

-- 6) fin_despesas — cabeçalho da conta a pagar (o "contrato") ----------------
create table if not exists public.fin_despesas (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  descricao text not null,
  observacao text,
  categoria_id uuid not null references public.fin_categorias (id) on delete restrict,
  centro_custo_id uuid references public.fin_centros_custo (id) on delete restrict,
  colaborador_id uuid references public.fin_colaboradores (id) on delete set null,
  valor_total numeric(14,2) not null check (valor_total >= 0),  -- = Σ parcelas (denormalizado p/ conferência)
  num_parcelas int not null default 1 check (num_parcelas > 0),
  recorrencia_id uuid references public.fin_recorrencias (id) on delete set null,
  fonte text not null default 'manual' check (fonte in ('manual','ca_import')),
  ca_evento_id text,                -- dedup do import do CA
  cancelada boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  unique (company_id, ca_evento_id)
);
create index if not exists fin_despesas_company_idx on public.fin_despesas (company_id, cancelada);
create index if not exists fin_despesas_categoria_idx on public.fin_despesas (categoria_id);

-- 7) fin_parcelas — a UNIDADE de rateio, BU e pagamento ----------------------
--    "Qual empresa paga ESTA parcela" = bu_id por parcela. À vista = 1 parcela.
create table if not exists public.fin_parcelas (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  despesa_id uuid not null references public.fin_despesas (id) on delete cascade,
  numero int not null check (numero > 0),
  bu_id uuid not null references public.business_units (id) on delete restrict,
  valor_previsto numeric(14,2) not null check (valor_previsto >= 0),
  valor_realizado numeric(14,2) check (valor_realizado is null or valor_realizado >= 0),  -- preenchido na baixa
  data_competencia date not null,   -- regime de competência (DRE)
  data_vencimento date not null,
  data_pagamento date,              -- null = não paga
  status text not null default 'a_pagar'
    check (status in ('prevista','a_pagar','paga','atrasada','cancelada')),
  metodo_pagamento text,            -- texto livre (pix/boleto/cartao/guru/stone/… — evolui sem migration)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  unique (despesa_id, numero)
);
create index if not exists fin_parcelas_company_idx on public.fin_parcelas (company_id);
create index if not exists fin_parcelas_bu_idx on public.fin_parcelas (bu_id);
create index if not exists fin_parcelas_competencia_idx on public.fin_parcelas (data_competencia);
create index if not exists fin_parcelas_vencimento_idx on public.fin_parcelas (data_vencimento);
create index if not exists fin_parcelas_status_idx on public.fin_parcelas (status);

-- 8) fin_despesa_rateio — rateio de UMA parcela entre várias BUs (opcional) --
--    Criada pronta, porém INERTE: só se usa na 1ª parcela genuinamente
--    compartilhada (ex. aluguel 50/50). Havendo rateio, ele manda; senão, o
--    bu_id da parcela. Σ percentual = 100% é validado na app (Passo 6/7).
create table if not exists public.fin_despesa_rateio (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  parcela_id uuid not null references public.fin_parcelas (id) on delete cascade,
  bu_id uuid not null references public.business_units (id) on delete restrict,
  percentual numeric(5,2) not null check (percentual > 0 and percentual <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (parcela_id, bu_id)
);
create index if not exists fin_despesa_rateio_parcela_idx on public.fin_despesa_rateio (parcela_id);

-- 9) fin_receita_snapshot — espelho da receita do CA (BU já resolvida) -------
--    Cache: o CA continua dono. dedup por ca_evento_id; categoria/BU podem
--    ficar null se a dimensão for removida (é derivado, não bloqueia).
create table if not exists public.fin_receita_snapshot (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  ca_evento_id text not null,
  categoria_id uuid references public.fin_categorias (id) on delete set null,
  bu_id uuid references public.business_units (id) on delete set null,
  valor numeric(14,2) not null check (valor >= 0),
  data_competencia date,
  data_vencimento date,
  data_pagamento date,
  recebido boolean not null default false,
  sincronizado_em timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, ca_evento_id)
);
create index if not exists fin_receita_snapshot_company_idx on public.fin_receita_snapshot (company_id);
create index if not exists fin_receita_snapshot_bu_idx on public.fin_receita_snapshot (bu_id);
create index if not exists fin_receita_snapshot_competencia_idx on public.fin_receita_snapshot (data_competencia);

-- 10) fin_orcamentos — meta AGREGADA (top-down) + teto de alerta -------------
--     Chave de agregação: categoria × BU × competência. bu_id null = "todas".
create table if not exists public.fin_orcamentos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  categoria_id uuid not null references public.fin_categorias (id) on delete cascade,
  bu_id uuid references public.business_units (id) on delete cascade,
  competencia text not null check (competencia ~ '^[0-9]{4}-[0-9]{2}$'),  -- 'AAAA-MM'
  valor_orcado numeric(14,2) not null check (valor_orcado >= 0),
  valor_limite numeric(14,2) check (valor_limite is null or valor_limite >= 0),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null
);
-- UNIQUE por (company, categoria, bu, competencia). coalesce trata bu null como
-- valor fixo (senão o Postgres deixaria duplicar orçamento "todas as BUs").
create unique index if not exists fin_orcamentos_uniq on public.fin_orcamentos
  (company_id, categoria_id, coalesce(bu_id, '00000000-0000-0000-0000-000000000000'::uuid), competencia);
create index if not exists fin_orcamentos_competencia_idx on public.fin_orcamentos (company_id, competencia);

-- 11) fin_alertas — materializa estouro pro card do painel -------------------
--     1 alerta por (categoria,bu,competencia,tipo): motor faz upsert (Passo 9),
--     nunca 1 por parcela.
create table if not exists public.fin_alertas (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  tipo text not null check (tipo in ('previsto_excede','limite_estourado')),
  categoria_id uuid not null references public.fin_categorias (id) on delete cascade,
  bu_id uuid references public.business_units (id) on delete cascade,
  competencia text not null check (competencia ~ '^[0-9]{4}-[0-9]{2}$'),
  valor_referencia numeric(14,2) not null,
  valor_limite numeric(14,2),
  status text not null default 'aberto' check (status in ('aberto','visto','resolvido')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists fin_alertas_uniq on public.fin_alertas
  (company_id, tipo, categoria_id, coalesce(bu_id, '00000000-0000-0000-0000-000000000000'::uuid), competencia);
create index if not exists fin_alertas_status_idx on public.fin_alertas (company_id, status);

-- 12) fin_audit_log — quem lançou/editou/pagou (append-only, sem updated_at) --
create table if not exists public.fin_audit_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  entidade text not null
    check (entidade in ('despesa','parcela','orcamento','categoria','centro','bu','colaborador','recorrencia')),
  entidade_id uuid,
  acao text not null check (acao in ('criar','editar','excluir','pagar','editar_massa')),
  diff jsonb,
  user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists fin_audit_log_company_idx on public.fin_audit_log (company_id, created_at desc);
create index if not exists fin_audit_log_entidade_idx on public.fin_audit_log (entidade, entidade_id);

-- 13) Triggers de updated_at (todas as tabelas com a coluna) -----------------
do $$
declare t text;
begin
  foreach t in array array[
    'business_units','fin_categorias','fin_centros_custo','fin_colaboradores',
    'fin_recorrencias','fin_despesas','fin_parcelas','fin_despesa_rateio',
    'fin_receita_snapshot','fin_orcamentos','fin_alertas'
  ] loop
    execute format('drop trigger if exists %I_set_updated_at on public.%I', t, t);
    execute format(
      'create trigger %I_set_updated_at before update on public.%I '
      || 'for each row execute function public.fin_set_updated_at()', t, t);
  end loop;
end $$;

-- 14) RLS: habilitar em todas, SEM policies/grants -> só service_role ---------
--     Segue contaazul_connections (0016): dado sensível admin-only não tem
--     acesso via `authenticated`; todo acesso passa pela app (lib/financeiro).
do $$
declare t text;
begin
  foreach t in array array[
    'business_units','fin_categorias','fin_centros_custo','fin_colaboradores',
    'fin_recorrencias','fin_despesas','fin_parcelas','fin_despesa_rateio',
    'fin_receita_snapshot','fin_orcamentos','fin_alertas','fin_audit_log'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ===========================================================================
-- ROLLBACK (rede de segurança — descomentar e rodar p/ desfazer o 0023):
-- drop table if exists
--   public.fin_audit_log, public.fin_alertas, public.fin_orcamentos,
--   public.fin_receita_snapshot, public.fin_despesa_rateio, public.fin_parcelas,
--   public.fin_despesas, public.fin_recorrencias, public.fin_colaboradores,
--   public.fin_centros_custo, public.fin_categorias, public.business_units
--   cascade;
-- drop function if exists public.fin_set_updated_at();
-- ===========================================================================
