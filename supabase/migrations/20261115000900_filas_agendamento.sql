-- Filas do worker (pgmq), agendamento de rotinas e manutenção (pg_cron).
--
-- Filas:
--   tarefas  -> task.run        (uma tarefa precisa de trabalho do orquestrador)
--   acoes    -> action.execute  (uma ação aprovada precisa ser executada)
--   rotinas  -> routine.fire    (uma rotina agendada venceu)

select pgmq.create('tarefas');
select pgmq.create('acoes');
select pgmq.create('rotinas');

create or replace function private.assert_known_queue(p_queue text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_queue is null or p_queue not in ('tarefas', 'acoes', 'rotinas') then
    raise exception 'Fila desconhecida: %', p_queue using errcode = '22023';
  end if;
end;
$$;

-- Funções expostas só para a chave secreta (worker), para usar a fila via API REST.
create or replace function public.queue_send(p_queue text, p_message jsonb, p_delay_seconds integer default 0)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_msg_id bigint;
begin
  perform private.assert_known_queue(p_queue);
  select pgmq.send(p_queue, p_message, greatest(coalesce(p_delay_seconds, 0), 0)) into v_msg_id;
  return v_msg_id;
end;
$$;

create or replace function public.queue_read(p_queue text, p_visibility_seconds integer, p_quantity integer)
returns table (msg_id bigint, read_ct integer, enqueued_at timestamptz, vt timestamptz, message jsonb)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_known_queue(p_queue);
  return query
    select r.msg_id, r.read_ct, r.enqueued_at, r.vt, r.message
    from pgmq.read(p_queue, greatest(p_visibility_seconds, 1), least(greatest(p_quantity, 1), 50)) r;
end;
$$;

create or replace function public.queue_archive(p_queue text, p_msg_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_known_queue(p_queue);
  return pgmq.archive(p_queue, p_msg_id);
end;
$$;

-- Estende (ou encurta) a invisibilidade de uma mensagem: usado como "batimento" durante
-- execuções longas e para reagendar com espera exponencial depois de uma falha.
create or replace function public.queue_set_visibility(p_queue text, p_msg_id bigint, p_visibility_seconds integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_known_queue(p_queue);
  perform pgmq.set_vt(p_queue, p_msg_id, greatest(p_visibility_seconds, 0));
end;
$$;

revoke all on function public.queue_send(text, jsonb, integer) from public, anon, authenticated;
revoke all on function public.queue_read(text, integer, integer) from public, anon, authenticated;
revoke all on function public.queue_archive(text, bigint) from public, anon, authenticated;
revoke all on function public.queue_set_visibility(text, bigint, integer) from public, anon, authenticated;
grant execute on function public.queue_send(text, jsonb, integer) to service_role;
grant execute on function public.queue_read(text, integer, integer) to service_role;
grant execute on function public.queue_archive(text, bigint) to service_role;
grant execute on function public.queue_set_visibility(text, bigint, integer) to service_role;

-- Rotinas vencidas vão para a fila. O worker processa, calcula o próximo horário a partir do
-- cron (no fuso da rotina) e libera a rotina de novo.
create or replace function private.enqueue_due_routines()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_routine record;
begin
  for v_routine in
    select r.id, r.org_id
    from public.routines r
    join public.employees e on e.id = r.employee_id
    join public.organizations o on o.id = r.org_id
    where r.enabled
      and not r.in_flight
      and r.next_run_at is not null
      and r.next_run_at <= now()
      and e.status <> 'pausado'
      and o.status = 'ativa'
    order by r.next_run_at
    limit 500
    for update of r skip locked
  loop
    update public.routines set in_flight = true, next_run_at = null where id = v_routine.id;
    perform pgmq.send(
      'rotinas',
      jsonb_build_object('type', 'routine.fire', 'routine_id', v_routine.id, 'org_id', v_routine.org_id)
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Aprovações pendentes vencidas expiram e devolvem a tarefa ao orquestrador, que avisa o
-- dono e encerra (o prompt orienta a não repetir o pedido em loop).
create or replace function private.expire_approvals()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with vencidas as (
    update public.approvals a
    set status = 'expirada', decided_at = now(), decision_channel = 'sistema'
    where a.status = 'pendente' and a.expires_at <= now()
    returning a.id, a.org_id, a.task_id, a.action_type
  ),
  auditoria as (
    insert into public.audit_log (org_id, actor_type, actor_id, action, target, task_id, payload_redacted)
    select v.org_id, 'sistema', 'expire_approvals', 'aprovacao.expirada', 'approval:' || v.id, v.task_id,
      jsonb_build_object('tipo', v.action_type)
    from vencidas v
    returning 1
  ),
  tarefas as (
    update public.tasks t
    set status = 'a_fazer'
    from vencidas v
    where t.id = v.task_id and t.org_id = v.org_id and t.status = 'aguardando_aprovacao'
    returning 1
  )
  select count(*) into v_count from vencidas;
  return v_count;
end;
$$;

revoke all on function private.enqueue_due_routines() from public;
revoke all on function private.expire_approvals() from public;
revoke all on function private.assert_known_queue(text) from public;

select cron.schedule('givance-rotinas-vencidas', '* * * * *', 'select private.enqueue_due_routines()');
select cron.schedule('givance-expirar-aprovacoes', '*/5 * * * *', 'select private.expire_approvals()');

-- Atualizações ao vivo no painel (Realtime respeita o RLS).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.tasks, public.approvals, public.employees, public.messages;
  end if;
end;
$$;
