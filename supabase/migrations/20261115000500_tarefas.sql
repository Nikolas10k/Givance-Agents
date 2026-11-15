-- Conversas, tarefas, execuções de agentes, passos e artefatos.

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  employee_id uuid not null,
  channel text not null default 'painel' check (channel in ('painel', 'whatsapp')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (employee_id, org_id) references public.employees (id, org_id) on delete cascade
);

create trigger conversations_updated_at before update on public.conversations
  for each row execute function private.set_updated_at();

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  employee_id uuid not null,
  parent_id uuid,
  conversation_id uuid,
  routine_id uuid,
  title text not null check (char_length(title) between 1 and 300),
  input jsonb not null default '{}'::jsonb check (jsonb_typeof(input) = 'object'),
  status text not null default 'a_fazer' check (
    status in ('a_fazer', 'em_andamento', 'aguardando_aprovacao', 'concluida', 'falhou', 'cancelada')
  ),
  source text not null check (source in ('painel', 'whatsapp', 'rotina', 'webhook', 'sistema')),
  -- Verdadeiro quando a tarefa nasceu de conteúdo de terceiros (e-mail, mensagem de lead).
  -- Ações pedidas nesse contexto nunca são automáticas.
  tainted boolean not null default false,
  assigned_agent text,
  result jsonb,
  error text check (char_length(error) <= 4000),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 2 check (max_attempts between 1 and 10),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  unique (id, org_id),
  foreign key (employee_id, org_id) references public.employees (id, org_id) on delete cascade,
  foreign key (parent_id, org_id) references public.tasks (id, org_id) on delete cascade,
  foreign key (conversation_id, org_id) references public.conversations (id, org_id)
    on delete set null (conversation_id),
  foreign key (routine_id, org_id) references public.routines (id, org_id)
    on delete set null (routine_id)
);

create index tasks_org_status_idx on public.tasks (org_id, status);
create index tasks_employee_status_idx on public.tasks (employee_id, status);
create index tasks_parent_idx on public.tasks (parent_id) where parent_id is not null;

create trigger tasks_updated_at before update on public.tasks
  for each row execute function private.set_updated_at();

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid not null,
  task_id uuid,
  author text not null check (author in ('dono', 'funcionario', 'sistema')),
  user_id uuid references auth.users (id) on delete set null,
  content text not null check (char_length(content) between 1 and 20000),
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  -- Mensagens do funcionário para o dono saem pelo canal da conversa (WhatsApp na Fase 1b).
  delivery_status text not null default 'nao_aplicavel'
    check (delivery_status in ('nao_aplicavel', 'pendente', 'enviada', 'falhou')),
  created_at timestamptz not null default now(),
  foreign key (conversation_id, org_id) references public.conversations (id, org_id) on delete cascade,
  foreign key (task_id, org_id) references public.tasks (id, org_id) on delete set null (task_id)
);

create index messages_conversation_idx on public.messages (conversation_id, created_at);

-- Uma execução do runtime de agentes para uma tarefa.
create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid not null,
  run_number integer not null check (run_number > 0),
  trigger text not null check (trigger in ('inicio', 'retomada', 'reexecucao')),
  status text not null default 'em_andamento'
    check (status in ('em_andamento', 'concluida', 'pausada', 'falhou', 'cancelada')),
  session_id text,
  model text,
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  cache_read_tokens bigint not null default 0 check (cache_read_tokens >= 0),
  cache_write_tokens bigint not null default 0 check (cache_write_tokens >= 0),
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  -- Tokens e custo estimado por agente (orquestrador e cada especialista).
  usage_by_agent jsonb not null default '{}'::jsonb check (jsonb_typeof(usage_by_agent) = 'object'),
  -- sha256 do prompt de cada agente usado nesta execução.
  prompt_hashes jsonb not null default '{}'::jsonb check (jsonb_typeof(prompt_hashes) = 'object'),
  tainted boolean not null default false,
  usage_recorded boolean not null default false,
  error text check (char_length(error) <= 4000),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  unique (id, org_id),
  unique (task_id, run_number),
  foreign key (task_id, org_id) references public.tasks (id, org_id) on delete cascade
);

create index agent_runs_org_started_idx on public.agent_runs (org_id, started_at desc);

-- Rastro fino de cada execução. Entradas e saídas sempre mascaradas (LGPD).
create table public.agent_steps (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  run_id uuid not null,
  agent text not null check (char_length(agent) <= 80),
  kind text not null check (kind in ('tool_call', 'delegacao', 'mensagem', 'erro')),
  tool_name text check (char_length(tool_name) <= 200),
  tool_use_id text check (char_length(tool_use_id) <= 200),
  status text check (status in ('ok', 'erro', 'negado')),
  input_redacted jsonb,
  output_redacted jsonb,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  created_at timestamptz not null default now(),
  foreign key (run_id, org_id) references public.agent_runs (id, org_id) on delete cascade
);

create index agent_steps_run_idx on public.agent_steps (run_id, id);

-- Saídas estruturadas dos especialistas.
create table public.artifacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid not null,
  kind text not null check (kind ~ '^[a-z][a-z0-9_]*$'),
  title text not null check (char_length(title) between 1 and 300),
  data jsonb not null,
  version integer not null default 1 check (version > 0),
  created_by_agent text not null check (char_length(created_by_agent) <= 80),
  created_at timestamptz not null default now(),
  unique (id, org_id),
  unique (task_id, kind, version),
  foreign key (task_id, org_id) references public.tasks (id, org_id) on delete cascade
);

alter table public.conversations enable row level security;
alter table public.tasks enable row level security;
alter table public.messages enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_steps enable row level security;
alter table public.artifacts enable row level security;

create policy "membros veem as conversas" on public.conversations
  for select to authenticated
  using (org_id in (select private.user_org_ids()) or (select private.is_givance_admin()));

create policy "membros veem as tarefas" on public.tasks
  for select to authenticated
  using (org_id in (select private.user_org_ids()) or (select private.is_givance_admin()));

create policy "membros veem as mensagens" on public.messages
  for select to authenticated
  using (org_id in (select private.user_org_ids()) or (select private.is_givance_admin()));

create policy "membros veem as execuções" on public.agent_runs
  for select to authenticated
  using (org_id in (select private.user_org_ids()) or (select private.is_givance_admin()));

create policy "membros veem os passos" on public.agent_steps
  for select to authenticated
  using (org_id in (select private.user_org_ids()) or (select private.is_givance_admin()));

create policy "membros veem os artefatos" on public.artifacts
  for select to authenticated
  using (org_id in (select private.user_org_ids()) or (select private.is_givance_admin()));

-- Tarefa em "a_fazer" vai para a fila do worker na mesma transação (sem mensagens perdidas).
create or replace function private.enqueue_task_run()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'a_fazer' and (tg_op = 'INSERT' or old.status is distinct from 'a_fazer') then
    perform pgmq.send(
      'tarefas',
      jsonb_build_object('type', 'task.run', 'task_id', new.id, 'org_id', new.org_id)
    );
  end if;
  return null;
end;
$$;

create trigger tasks_enqueue after insert or update of status on public.tasks
  for each row execute function private.enqueue_task_run();

-- Status do funcionário acompanha as tarefas: aguardando aprovação > trabalhando > ocioso.
create or replace function private.refresh_employee_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  select case
    when bool_or(t.status = 'aguardando_aprovacao') then 'aguardando_aprovacao'
    when bool_or(t.status in ('a_fazer', 'em_andamento')) then 'trabalhando'
    else 'ocioso'
  end
  into v_status
  from public.tasks t
  where t.employee_id = new.employee_id
    and t.status in ('a_fazer', 'em_andamento', 'aguardando_aprovacao');

  update public.employees e
  set status = coalesce(v_status, 'ocioso')
  where e.id = new.employee_id
    and e.status <> 'pausado'
    and e.status is distinct from coalesce(v_status, 'ocioso');

  return null;
end;
$$;

create trigger tasks_refresh_employee_status after insert or update of status on public.tasks
  for each row execute function private.refresh_employee_status();

-- Cria uma tarefa a partir do painel. O usuário precisa ser membro da empresa do funcionário.
create or replace function public.create_task(
  p_employee_id uuid,
  p_title text,
  p_input jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_employee_status text;
  v_task_id uuid;
begin
  select e.org_id, e.status into v_org_id, v_employee_status
  from public.employees e
  where e.id = p_employee_id;

  if v_org_id is null
    or not exists (select 1 from private.user_org_ids() o where o = v_org_id) then
    raise exception 'Funcionário não encontrado' using errcode = 'P0002';
  end if;

  if v_employee_status = 'pausado' then
    raise exception 'Este funcionário está pausado' using errcode = '55000';
  end if;

  if p_input is not null and jsonb_typeof(p_input) <> 'object' then
    raise exception 'Entrada da tarefa inválida' using errcode = '22023';
  end if;

  insert into public.tasks (org_id, employee_id, title, input, source, created_by)
  values (v_org_id, p_employee_id, p_title, coalesce(p_input, '{}'::jsonb), 'painel', auth.uid())
  returning id into v_task_id;

  insert into public.audit_log (org_id, actor_type, actor_id, action, target, task_id)
  values (v_org_id, 'usuario', auth.uid()::text, 'tarefa.criada', 'task:' || v_task_id, v_task_id);

  return v_task_id;
end;
$$;

revoke all on function public.create_task(uuid, text, jsonb) from public, anon;
grant execute on function public.create_task(uuid, text, jsonb) to authenticated, service_role;
