-- Cargos (catálogo global da Givance), versões imutáveis, funcionários contratados e rotinas.

create table public.roles (
  key text primary key check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  display_name text not null check (char_length(display_name) between 1 and 120),
  description text not null check (char_length(description) <= 2000),
  created_at timestamptz not null default now()
);

-- Uma versão de cargo é imutável: mudar estrutura (agentes, ferramentas, permissões,
-- limites, rotinas) exige uma versão nova. Os prompts não ficam aqui: acompanham o deploy
-- (agents/<nome>/system.md) e o hash usado em cada execução fica em agent_runs.
create table public.role_versions (
  id uuid primary key default gen_random_uuid(),
  role_key text not null references public.roles (key) on delete restrict,
  version integer not null check (version > 0),
  config jsonb not null check (jsonb_typeof(config) = 'object'),
  config_sha256 text not null check (config_sha256 ~ '^[0-9a-f]{64}$'),
  published_at timestamptz not null default now(),
  unique (role_key, version)
);

create or replace function private.role_versions_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Versões de cargo são imutáveis. Publique uma versão nova.'
    using errcode = '42501';
end;
$$;

create trigger role_versions_immutable before update on public.role_versions
  for each row execute function private.role_versions_immutable();

alter table public.roles enable row level security;
alter table public.role_versions enable row level security;

create policy "usuários logados leem o catálogo de cargos" on public.roles
  for select to authenticated using (true);

create policy "usuários logados leem versões de cargos" on public.role_versions
  for select to authenticated using (true);

-- Funcionário contratado: preso a uma versão de cargo.
create table public.employees (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  role_version_id uuid not null references public.role_versions (id) on delete restrict,
  display_name text not null check (char_length(display_name) between 1 and 80),
  -- Derivado das tarefas (ver private.refresh_employee_status), exceto "pausado".
  status text not null default 'ocioso'
    check (status in ('trabalhando', 'aguardando_aprovacao', 'ocioso', 'pausado')),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  hired_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id)
);

create index employees_org_id_idx on public.employees (org_id);

create trigger employees_updated_at before update on public.employees
  for each row execute function private.set_updated_at();

alter table public.employees enable row level security;

create policy "membros veem os funcionários" on public.employees
  for select to authenticated
  using (org_id in (select private.user_org_ids()) or (select private.is_givance_admin()));

create policy "dono e admin editam funcionários" on public.employees
  for update to authenticated
  using (org_id in (select private.user_org_ids_with_role(array['owner', 'admin'])))
  with check (org_id in (select private.user_org_ids_with_role(array['owner', 'admin'])));

grant update (display_name, settings) on public.employees to authenticated;

-- Rotinas agendadas de um funcionário. "tarefa" vira uma tarefa para o orquestrador;
-- "job" é um trabalho de sistema, sem modelo (ex.: sincronizar e-mails novos).
create table public.routines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  employee_id uuid not null,
  routine_key text not null check (routine_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  kind text not null check (kind in ('tarefa', 'job')),
  cron text not null check (char_length(cron) between 9 and 100),
  timezone text not null default 'America/Sao_Paulo',
  task_template jsonb not null default '{}'::jsonb check (jsonb_typeof(task_template) = 'object'),
  job_type text check (job_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  enabled boolean not null default true,
  -- Calculado pelo worker a partir do cron. Nulo = ainda não agendada.
  next_run_at timestamptz,
  -- Verdadeiro entre o enfileiramento e o processamento pelo worker.
  in_flight boolean not null default false,
  last_run_at timestamptz,
  last_error text check (char_length(last_error) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, routine_key),
  unique (id, org_id),
  foreign key (employee_id, org_id) references public.employees (id, org_id) on delete cascade,
  check ((kind = 'job') = (job_type is not null))
);

create index routines_due_idx on public.routines (next_run_at) where enabled and not in_flight;

create or replace function private.routines_reschedule_on_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.cron is distinct from old.cron
    or new.timezone is distinct from old.timezone
    or (new.enabled and not old.enabled) then
    new.next_run_at := null;
    new.last_error := null;
  end if;
  return new;
end;
$$;

create trigger routines_reschedule before update on public.routines
  for each row execute function private.routines_reschedule_on_change();

create trigger routines_updated_at before update on public.routines
  for each row execute function private.set_updated_at();

alter table public.routines enable row level security;

create policy "membros veem as rotinas" on public.routines
  for select to authenticated
  using (org_id in (select private.user_org_ids()) or (select private.is_givance_admin()));

create policy "dono e admin ajustam rotinas" on public.routines
  for update to authenticated
  using (org_id in (select private.user_org_ids_with_role(array['owner', 'admin'])))
  with check (org_id in (select private.user_org_ids_with_role(array['owner', 'admin'])));

grant update (enabled, cron, timezone) on public.routines to authenticated;

-- Contrata um funcionário e copia as rotinas da versão do cargo. Usado pelo admin da
-- Givance (chave secreta) e pelo seed.
create or replace function public.hire_employee(
  p_org_id uuid,
  p_role_key text,
  p_role_version integer,
  p_display_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role_version public.role_versions%rowtype;
  v_timezone text;
  v_employee_id uuid;
  v_routine jsonb;
begin
  select * into v_role_version
  from public.role_versions rv
  where rv.role_key = p_role_key and rv.version = p_role_version;

  if not found then
    raise exception 'Cargo % v% não publicado', p_role_key, p_role_version using errcode = 'P0002';
  end if;

  select o.timezone into v_timezone from public.organizations o where o.id = p_org_id;
  if v_timezone is null then
    raise exception 'Empresa não encontrada' using errcode = 'P0002';
  end if;

  insert into public.employees (org_id, role_version_id, display_name)
  values (p_org_id, v_role_version.id, p_display_name)
  returning id into v_employee_id;

  for v_routine in select * from jsonb_array_elements(coalesce(v_role_version.config -> 'rotinas', '[]'::jsonb))
  loop
    insert into public.routines (org_id, employee_id, routine_key, kind, cron, timezone, task_template, job_type)
    values (
      p_org_id,
      v_employee_id,
      v_routine ->> 'id',
      case when v_routine ? 'job' then 'job' else 'tarefa' end,
      v_routine ->> 'cron',
      coalesce(v_routine ->> 'fuso', v_timezone),
      case
        when v_routine ? 'job' then '{}'::jsonb
        else jsonb_strip_nulls(jsonb_build_object(
          'titulo', v_routine ->> 'titulo',
          'instrucoes', v_routine ->> 'tarefa',
          'agente_inicial', v_routine ->> 'agente_inicial'
        ))
      end,
      v_routine ->> 'job'
    );
  end loop;

  insert into public.audit_log (org_id, actor_type, actor_id, action, target, payload_redacted)
  values (
    p_org_id, 'sistema', 'hire_employee', 'funcionario.contratado', 'employee:' || v_employee_id,
    jsonb_build_object('cargo', p_role_key, 'versao', p_role_version)
  );

  return v_employee_id;
end;
$$;

revoke all on function public.hire_employee(uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.hire_employee(uuid, text, integer, text) to service_role;
