-- Log de auditoria imutável, consumo mensal e exclusão de empresa (LGPD).

create table public.audit_log (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  actor_type text not null check (actor_type in ('agente', 'usuario', 'sistema')),
  actor_id text not null check (char_length(actor_id) <= 200),
  action text not null check (char_length(action) between 1 and 100),
  target text check (char_length(target) <= 300),
  reason text check (char_length(reason) <= 4000),
  task_id uuid,
  run_id uuid,
  tokens bigint check (tokens is null or tokens >= 0),
  cost_usd numeric(12, 6) check (cost_usd is null or cost_usd >= 0),
  -- Sempre mascarado antes de gravar (telefones, e-mails, documentos, tokens).
  payload_redacted jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_org_created_idx on public.audit_log (org_id, created_at desc);
create index audit_log_task_idx on public.audit_log (task_id) where task_id is not null;

alter table public.audit_log enable row level security;

create policy "membros leem a auditoria da empresa" on public.audit_log
  for select to authenticated
  using (org_id in (select private.user_org_ids()) or (select private.is_givance_admin()));

-- Ninguém altera nem apaga registros, nem com a chave secreta. A única exceção é a
-- exclusão completa de uma empresa (admin_purge_organization), que liga uma flag local.
revoke update, delete, truncate on public.audit_log from authenticated, service_role;

create or replace function private.audit_log_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and current_setting('givance.purge_in_progress', true) = 'on' then
    return old;
  end if;
  raise exception 'O log de auditoria não pode ser alterado nem apagado' using errcode = '42501';
end;
$$;

create trigger audit_log_immutable before update or delete on public.audit_log
  for each row execute function private.audit_log_immutable();

create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function private.audit_log_immutable();

-- Consumo agregado por mês e por funcionário: base para "uso e custo do mês" e margem.
create table public.usage_ledger (
  org_id uuid not null references public.organizations (id) on delete cascade,
  period date not null check (extract(day from period) = 1),
  employee_id uuid not null,
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  cache_read_tokens bigint not null default 0 check (cache_read_tokens >= 0),
  cache_write_tokens bigint not null default 0 check (cache_write_tokens >= 0),
  cost_usd numeric(14, 6) not null default 0 check (cost_usd >= 0),
  runs integer not null default 0 check (runs >= 0),
  updated_at timestamptz not null default now(),
  primary key (org_id, period, employee_id),
  foreign key (employee_id, org_id) references public.employees (id, org_id) on delete cascade
);

alter table public.usage_ledger enable row level security;

create policy "membros veem o consumo" on public.usage_ledger
  for select to authenticated
  using (org_id in (select private.user_org_ids()) or (select private.is_givance_admin()));

-- Soma o consumo de uma execução ao mês corrente, uma única vez por execução.
create or replace function public.record_run_usage(p_run_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.agent_runs%rowtype;
  v_employee_id uuid;
begin
  select * into v_run from public.agent_runs r where r.id = p_run_id for update;
  if not found then
    raise exception 'Execução não encontrada' using errcode = 'P0002';
  end if;
  if v_run.usage_recorded then
    return false;
  end if;

  select t.employee_id into v_employee_id from public.tasks t where t.id = v_run.task_id;

  insert into public.usage_ledger as u (
    org_id, period, employee_id, input_tokens, output_tokens, cache_read_tokens,
    cache_write_tokens, cost_usd, runs
  )
  values (
    v_run.org_id,
    date_trunc('month', v_run.started_at at time zone 'America/Sao_Paulo')::date,
    v_employee_id,
    v_run.input_tokens, v_run.output_tokens, v_run.cache_read_tokens,
    v_run.cache_write_tokens, v_run.cost_usd, 1
  )
  on conflict (org_id, period, employee_id) do update set
    input_tokens = u.input_tokens + excluded.input_tokens,
    output_tokens = u.output_tokens + excluded.output_tokens,
    cache_read_tokens = u.cache_read_tokens + excluded.cache_read_tokens,
    cache_write_tokens = u.cache_write_tokens + excluded.cache_write_tokens,
    cost_usd = u.cost_usd + excluded.cost_usd,
    runs = u.runs + 1,
    updated_at = now();

  update public.agent_runs set usage_recorded = true where id = p_run_id;
  return true;
end;
$$;

revoke all on function public.record_run_usage(uuid) from public, anon, authenticated;
grant execute on function public.record_run_usage(uuid) to service_role;

-- Exclusão completa de uma empresa (LGPD). Apaga dados, segredos no Vault (via cascata
-- em private.connection_secrets) e o log de auditoria. Exige o slug como confirmação.
create or replace function public.admin_purge_organization(p_org_id uuid, p_confirm_slug text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text;
begin
  select o.slug into v_slug from public.organizations o where o.id = p_org_id;
  if v_slug is null then
    raise exception 'Empresa não encontrada' using errcode = 'P0002';
  end if;
  if v_slug <> p_confirm_slug then
    raise exception 'A confirmação não confere com a empresa' using errcode = '22023';
  end if;

  perform set_config('givance.purge_in_progress', 'on', true);
  delete from public.organizations where id = p_org_id;
  perform set_config('givance.purge_in_progress', 'off', true);
end;
$$;

revoke all on function public.admin_purge_organization(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_purge_organization(uuid, text) to service_role;
