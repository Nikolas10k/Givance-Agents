-- Operações atômicas do worker: assumir uma tarefa e reenfileirar com espera.

-- O gatilho de enfileiramento passa a aceitar um atraso, definido na transação por
-- requeue_task (para tentar de novo com espera, sem perder a garantia transacional).
create or replace function private.enqueue_task_run()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delay integer := coalesce(nullif(current_setting('givance.enqueue_delay', true), '')::integer, 0);
begin
  if new.status = 'a_fazer' and (tg_op = 'INSERT' or old.status is distinct from 'a_fazer') then
    perform pgmq.send(
      'tarefas',
      jsonb_build_object('type', 'task.run', 'task_id', new.id, 'org_id', new.org_id),
      greatest(v_delay, 0)
    );
  end if;
  return null;
end;
$$;

-- Assume uma tarefa em "a_fazer": passa para "em_andamento" e abre uma execução, na mesma
-- transação. Se outro worker já assumiu, não devolve nada.
create or replace function public.claim_task(p_task_id uuid)
returns table (
  task_id uuid,
  org_id uuid,
  run_id uuid,
  run_number integer,
  run_trigger text,
  attempts integer,
  max_attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks%rowtype;
  v_last_status text;
  v_next integer;
  v_trigger text;
  v_run_id uuid;
begin
  update public.tasks t
  set status = 'em_andamento',
      attempts = t.attempts + 1,
      started_at = coalesce(t.started_at, now()),
      error = null
  where t.id = p_task_id and t.status = 'a_fazer'
  returning * into v_task;

  if not found then
    return;
  end if;

  select r.status into v_last_status
  from public.agent_runs r
  where r.task_id = v_task.id
  order by r.run_number desc
  limit 1;

  select coalesce(max(r.run_number), 0) + 1 into v_next from public.agent_runs r where r.task_id = v_task.id;

  v_trigger := case
    when v_last_status is null then 'inicio'
    when v_last_status = 'falhou' then 'reexecucao'
    else 'retomada'
  end;

  insert into public.agent_runs (org_id, task_id, run_number, trigger, tainted)
  values (v_task.org_id, v_task.id, v_next, v_trigger, v_task.tainted)
  returning id into v_run_id;

  return query select v_task.id, v_task.org_id, v_run_id, v_next, v_trigger, v_task.attempts, v_task.max_attempts;
end;
$$;

-- Devolve a tarefa para "a_fazer" com espera antes da próxima tentativa.
create or replace function public.requeue_task(p_task_id uuid, p_delay_seconds integer, p_reason text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('givance.enqueue_delay', greatest(coalesce(p_delay_seconds, 0), 0)::text, true);
  update public.tasks
  set status = 'a_fazer', error = left(p_reason, 4000)
  where id = p_task_id and status in ('em_andamento', 'aguardando_aprovacao');
  perform set_config('givance.enqueue_delay', '0', true);
  return found;
end;
$$;

revoke all on function public.claim_task(uuid) from public, anon, authenticated;
revoke all on function public.requeue_task(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.claim_task(uuid) to service_role;
grant execute on function public.requeue_task(uuid, integer, text) to service_role;
