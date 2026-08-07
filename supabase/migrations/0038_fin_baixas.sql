-- 0038_fin_baixas.sql — Baixas parciais ("despesa-envelope").
--
-- PROBLEMA. Uma conta como "REPOSIÇÃO DE ESTOQUE — R$ 10.000" não é fatura: é um
-- teto consumido por compras pequenas (R$ 50 de água sanitária, R$ 200 de
-- vassouras). Até aqui só havia "pagar tudo" ou "pagar com desconto" — o
-- primeiro mente sobre a data, o segundo encerra a conta que ainda tem saldo.
--
-- MODELO. Cada pagamento real vira uma linha em `fin_baixas`, com data, valor e
-- descrição próprios. A parcela deixa de ser paga/não-paga e passa a ter SALDO:
--   previsto (o envelope)  −  Σ baixas (o consumido)  =  saldo
--
-- POR QUE DATA POR BAIXA. A parcela tem UM `data_pagamento`. Se as compras
-- acontecem em 05/08, 20/08 e 03/09, uma data só obriga a mentir sobre duas — e
-- quebra o regime "Visão de Caixa" do DRE, que agrupa por quando o dinheiro se
-- move. Com data por baixa, cada compra cai no mês certo sozinha.
--
-- O ENVELOPE É EMERGENTE. Não há marcador de tipo na despesa: qualquer conta
-- pode receber baixa parcial, e o envelope nasce no primeiro lançamento parcial.
-- Declarar na criação obrigaria a prever o futuro.
--
-- Ver docs/financeiro-baixas-parciais.md.

-- ============================================================================
-- 1. Tabela de baixas
-- ============================================================================

create table if not exists public.fin_baixas (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  parcela_id  uuid not null references public.fin_parcelas(id) on delete cascade,

  -- Quando o dinheiro SAIU. Alimenta o regime Visão de Caixa do DRE.
  data          date not null,
  -- A que mês o custo pertence. Herda a competência da parcela por padrão, mas
  -- é editável: uma compra de setembro contra o envelope de agosto pode ser
  -- custo de qualquer um dos dois, e só quem lança sabe.
  competencia   date not null,

  valor       numeric(14,2) not null check (valor > 0),
  -- "vassouras", "água sanitária". É o que transforma a lista de baixas em
  -- história em vez de pilha de valores.
  descricao   text,
  metodo_pagamento text,
  observacao  text,

  created_at  timestamptz not null default now(),
  created_by  uuid
);

create index if not exists fin_baixas_parcela_idx  on public.fin_baixas (parcela_id);
create index if not exists fin_baixas_data_idx     on public.fin_baixas (company_id, data);
create index if not exists fin_baixas_comp_idx     on public.fin_baixas (company_id, competencia);

alter table public.fin_baixas enable row level security;
-- Sem policies: lido/gravado via service_role no servidor, atrás de `can('financeiro')`.
-- Mesmo padrão das demais tabelas de `fin_*`.

-- ============================================================================
-- 2. Novo estado da parcela: 'parcial'
-- ============================================================================
-- Entre "a pagar" (nada consumido) e "paga" (consumida por inteiro).

alter table public.fin_parcelas drop constraint if exists fin_parcelas_status_check;
alter table public.fin_parcelas add constraint fin_parcelas_status_check
  check (status in ('prevista','a_pagar','paga','parcial','atrasada','cancelada'));

-- ============================================================================
-- 3. Encerramento com motivo
-- ============================================================================
-- Sobrou saldo e o envelope não será mais usado. Encerrar tira a conta do "a
-- pagar" SEM apagar o plano: `valor_previsto` continua sendo o que foi
-- planejado, e o DRE segue mostrando "planejei 10 mil, gastei 7,3 mil".
--
-- O motivo é obrigatório na aplicação (não aqui, para não travar a migration
-- retroativa): meses depois ninguém lembra se sobrou por economia ou por
-- esquecimento de lançar.

alter table public.fin_parcelas
  add column if not exists encerrada_em     date,
  add column if not exists encerrada_motivo text;

-- ============================================================================
-- 4. Migration retroativa
-- ============================================================================
-- Parcelas já pagas não têm baixa. Sem isto o DRE precisaria de DOIS caminhos
-- para sempre (ler baixas OU cair na parcela), e dois caminhos divergem.
--
-- Cria UMA baixa para cada parcela paga, copiando valor, data e método. A
-- competência vem da própria parcela. `descricao` fica nula de propósito: não
-- inventamos um "o que foi" que ninguém informou.

insert into public.fin_baixas (
  company_id, parcela_id, data, competencia, valor, descricao, metodo_pagamento, observacao
)
select
  p.company_id,
  p.id,
  coalesce(p.data_pagamento, p.data_vencimento),
  p.data_competencia,
  coalesce(p.valor_realizado, p.valor_previsto),
  null,
  p.metodo_pagamento,
  'Baixa criada na migration 0038 a partir do pagamento já registrado.'
from public.fin_parcelas p
where p.status = 'paga'
  and coalesce(p.valor_realizado, p.valor_previsto) > 0
  -- idempotente: reexecutar não duplica
  and not exists (select 1 from public.fin_baixas b where b.parcela_id = p.id);

-- ============================================================================
-- ROLLBACK:
--   alter table public.fin_parcelas drop column if exists encerrada_motivo;
--   alter table public.fin_parcelas drop column if exists encerrada_em;
--   alter table public.fin_parcelas drop constraint if exists fin_parcelas_status_check;
--   alter table public.fin_parcelas add constraint fin_parcelas_status_check
--     check (status in ('prevista','a_pagar','paga','atrasada','cancelada'));
--   drop table if exists public.fin_baixas;
-- ============================================================================
