-- Agentes = IAs com persona/prompt próprios, compartilhados por empresa (estilo
-- Evo-Nexus: "Mako" de marketing). Conversar com um agente injeta o system_prompt
-- dele no chat (mantendo o RAG da empresa). Rodar no SQL Editor.

-- 1) Tabela de agentes (por empresa) --------------------------------------------
create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  description text not null default '',
  system_prompt text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);
alter table public.agents enable row level security;
create index if not exists agents_company_idx on public.agents (company_id);

-- Defensivo: se uma execução anterior criou a coluna emoji, remove (minimalista).
alter table public.agents drop column if exists emoji;

-- 2) Vínculo conversa -> agente (nulo = chat comum, sem persona) ----------------
alter table public.conversations
  add column if not exists agent_id uuid references public.agents (id) on delete set null;
create index if not exists conversations_agent_idx on public.conversations (agent_id);

-- 3) Seed: um agente de Marketing de exemplo por empresa ------------------------
insert into public.agents (company_id, name, description, system_prompt)
select
  c.id,
  'Marketing',
  'Idealiza campanhas, conteúdo e posicionamento de marca.',
  'Você é o agente de Marketing da empresa. Tudo o que for conversado deve ser '
  || 'pensado sob a ótica de marketing: campanhas, conteúdo, posicionamento de '
  || 'marca, funil, público-alvo (ICP), SEO e métricas. Seja estratégico e '
  || 'prático, traga ideias acionáveis e use o conhecimento da empresa quando '
  || 'disponível. Responda em português do Brasil.'
from public.companies c
where not exists (
  select 1 from public.agents a where a.company_id = c.id and a.name = 'Marketing'
);

-- 4) RLS: leitura pelos membros da empresa (superadmin vê todas). Escrita só via
--    service_role (server actions autorizadas) — sem policy de write.
drop policy if exists "agents_select_company" on public.agents;
create policy "agents_select_company" on public.agents
  for select using (company_id = public.current_company_id() or public.is_superadmin());

grant select on public.agents to authenticated;

-- 5) Conceder a feature "agentes" às roles built-in existentes (o enforcement por
--    can() já está ligado; sem isto ninguém veria Agentes). `||` mescla no jsonb.
update public.roles
set permissions = permissions || '{"agentes":["ver","gerenciar"]}'::jsonb
where name = 'Administrador' and not (permissions ? 'agentes');

update public.roles
set permissions = permissions || '{"agentes":["ver"]}'::jsonb
where name = 'Membro' and not (permissions ? 'agentes');
