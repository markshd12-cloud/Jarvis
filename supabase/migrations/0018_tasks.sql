  -- Espelho estruturado das TAREFAS do Notion (board "Tarefas" por empresa).
  -- Rodar após a 0017. Diferente do RAG (documents/chunks, busca por similaridade),
  -- tarefas pedem CONSULTA ESTRUTURADA: "em andamento do Mark", "atribuição da task X".
  -- Por isso viram colunas tipadas, não embeddings.

  -- Busca por título via similaridade de trigramas (ILIKE acelerado).
  create extension if not exists pg_trgm with schema extensions;

  create table if not exists public.tasks (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references public.companies (id) on delete cascade,
    notion_page_id text not null,
    title text not null default '',
    description text,
    status text,                         -- Não iniciada | Pausada | Em andamento | Concluída | Cancelada
    priority text,                       -- matriz de Eisenhower (Importante e Urgente, ...)
    due_date date,                       -- PRAZO
    assignees text[] not null default '{}',   -- nomes dos RESPONSÁVEIS
    attribution text[] not null default '{}', -- ATRIBUIÇÃO (70% | 20% | 10%)
    okr text,                            -- nome do Resultado-Chave atrelado (relation resolvida)
    objetivo text,                       -- nome do Objetivo Estratégico atrelado (relation resolvida)
    url text,
    last_edited_at timestamptz,
    synced_at timestamptz not null default now(),
    unique (company_id, notion_page_id)
  );

  alter table public.tasks enable row level security;

  -- Leitura por empresa (o chat consulta via service_role, mas a RLS é defesa extra).
  drop policy if exists "tasks_select_company" on public.tasks;
  create policy "tasks_select_company" on public.tasks
    for select using (company_id = public.current_company_id());
  grant select on public.tasks to authenticated;

  create index if not exists tasks_company_status_idx on public.tasks (company_id, status);
  create index if not exists tasks_company_due_idx    on public.tasks (company_id, due_date);
  create index if not exists tasks_assignees_idx      on public.tasks using gin (assignees);
  -- Busca por título (ILIKE) para "atribuição da tarefa X".
  create index if not exists tasks_title_trgm_idx     on public.tasks using gin (title gin_trgm_ops);

  -- Estado de sync das tarefas (guardado junto da conexão do Notion).
  alter table public.notion_connections
    add column if not exists tasks_data_source_id text,
    add column if not exists tasks_watermark timestamptz,
    add column if not exists tasks_synced_at timestamptz;
