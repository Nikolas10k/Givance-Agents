-- Aprovações, execuções de ações aprovadas e política de autonomia por empresa.
--
-- Fluxo: o agente propõe uma ação (payload validado no worker) -> fica "pendente" ou já
-- nasce "aprovada" quando o nível é automático -> ao ser aprovada, entra na fila "acoes"
-- -> o worker executa exatamente o payload aprovado (ou o editado), uma única vez.

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid not null,
  run_id uuid,
  action_type text not null check (action_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  payload jsonb not null,
  edited_payload jsonb check (edited_payload is null or jsonb_typeof(edited_payload) = 'object'),
  -- O que o dono vê no card: textos, imagens, valores. Montado pelo worker.
  preview jsonb not null default '{}'::jsonb check (jsonb_typeof(preview) = 'object'),
  reason text check (char_length(reason) <= 2000),
  autonomy_level text not null check (autonomy_level in ('sempre_aprovar', 'confirmar', 'automatico')),
  risk_level text not null default 'medio' check (risk_level in ('baixo', 'medio', 'alto')),
  status text not null default 'pendente'
    check (status in ('pendente', 'aprovada', 'editada', 'recusada', 'expirada', 'cancelada')),
  requested_by_agent text not null check (char_length(requested_by_agent) <= 80),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decision_channel text check (decision_channel in ('painel', 'whatsapp', 'sistema')),
  decision_note text check (char_length(decision_note) <= 2000),
  expires_at timestamptz not null default now() + interval '72 hours',
  -- Mesma tarefa + mesmo tipo + mesmo payload = mesma aprovação (o agente não duplica cards).
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, idempotency_key),
  unique (id, org_id),
  foreign key (task_id, org_id) references public.tasks (id, org_id) on delete cascade,
  check ((status = 'editada') = (edited_payload is not null)),
  check (status = 'pendente' or decided_at is not null)
);

create index approvals_org_status_idx on public.approvals (org_id, status);
create index approvals_task_idx on public.approvals (task_id);
create index approvals_pending_expiry_idx on public.approvals (expires_at) where status = 'pendente';

create trigger approvals_updated_at before update on public.approvals
  for each row execute function private.set_updated_at();

-- run_id aponta para a execução que pediu a ação (pode sumir sem apagar a aprovação).
alter table public.approvals
  add constraint approvals_run_fk foreign key (run_id, org_id)
  references public.agent_runs (id, org_id) on delete set null (run_id);

create table public.action_executions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  approval_id uuid not null,
  attempt integer not null default 1 check (attempt > 0),
  status text not null default 'executando' check (status in ('executando', 'sucesso', 'falhou')),
  external_ids jsonb not null default '{}'::jsonb check (jsonb_typeof(external_ids) = 'object'),
  result_redacted jsonb,
  error text check (char_length(error) <= 4000),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (approval_id, attempt),
  foreign key (approval_id, org_id) references public.approvals (id, org_id) on delete cascade
);

-- No máximo uma execução em andamento e uma com sucesso por aprovação:
-- dois workers nunca executam a mesma ação ao mesmo tempo, nem duas vezes.
create unique index action_executions_one_running_idx
  on public.action_executions (approval_id) where status = 'executando';
create unique index action_executions_one_success_idx
  on public.action_executions (approval_id) where status = 'sucesso';

-- Nível de autonomia escolhido pela empresa para cada tipo de ação. Os pisos fixos
-- (gasto sempre com aprovação, exclusão proibida, conteúdo de terceiros nunca automático)
-- são aplicados no worker e não podem ser afrouxados por aqui.
create table public.autonomy_policies (
  org_id uuid not null references public.organizations (id) on delete cascade,
  action_type text not null check (action_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  level text not null check (level in ('sempre_aprovar', 'confirmar', 'automatico')),
  limits jsonb not null default '{}'::jsonb check (jsonb_typeof(limits) = 'object'),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (org_id, action_type)
);

create trigger autonomy_policies_updated_at before update on public.autonomy_policies
  for each row execute function private.set_updated_at();

alter table public.approvals enable row level security;
alter table public.action_executions enable row level security;
alter table public.autonomy_policies enable row level security;

create policy "membros veem as aprovações" on public.approvals
  for select to authenticated
  using (org_id in (select private.user_org_ids()) or (select private.is_givance_admin()));

create policy "membros veem as execuções de ações" on public.action_executions
  for select to authenticated
  using (org_id in (select private.user_org_ids()) or (select private.is_givance_admin()));

create policy "membros veem a política de autonomia" on public.autonomy_policies
  for select to authenticated
  using (org_id in (select private.user_org_ids()) or (select private.is_givance_admin()));

create policy "dono e admin definem autonomia" on public.autonomy_policies
  for insert to authenticated
  with check (org_id in (select private.user_org_ids_with_role(array['owner', 'admin'])));

create policy "dono e admin alteram autonomia" on public.autonomy_policies
  for update to authenticated
  using (org_id in (select private.user_org_ids_with_role(array['owner', 'admin'])))
  with check (org_id in (select private.user_org_ids_with_role(array['owner', 'admin'])));

create policy "dono e admin removem autonomia" on public.autonomy_policies
  for delete to authenticated
  using (org_id in (select private.user_org_ids_with_role(array['owner', 'admin'])));

grant insert, update, delete on public.autonomy_policies to authenticated;

-- Aprovada (ou editada) -> fila "acoes", na mesma transação da decisão.
create or replace function private.enqueue_action_execution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('aprovada', 'editada')
    and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform pgmq.send(
      'acoes',
      jsonb_build_object('type', 'action.execute', 'approval_id', new.id, 'org_id', new.org_id)
    );
  end if;
  return null;
end;
$$;

create trigger approvals_enqueue after insert or update of status on public.approvals
  for each row execute function private.enqueue_action_execution();

-- Decisão do dono ou admin sobre uma aprovação pendente.
-- Os campos da aprovação não podem ser alterados diretamente pelo usuário: tudo passa aqui.
create or replace function public.decide_approval(
  p_approval_id uuid,
  p_decision text,
  p_edited_payload jsonb default null,
  p_note text default null,
  p_channel text default 'painel'
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_approval public.approvals%rowtype;
  v_new_status text;
begin
  if p_decision not in ('aprovar', 'recusar') then
    raise exception 'Decisão inválida: use aprovar ou recusar' using errcode = '22023';
  end if;

  if p_channel not in ('painel', 'whatsapp') then
    raise exception 'Canal de decisão inválido' using errcode = '22023';
  end if;

  select * into v_approval from public.approvals a where a.id = p_approval_id for update;

  if not found or not exists (
    select 1 from private.user_org_ids_with_role(array['owner', 'admin']) o where o = v_approval.org_id
  ) then
    raise exception 'Aprovação não encontrada' using errcode = 'P0002';
  end if;

  if v_approval.status <> 'pendente' then
    raise exception 'Esta aprovação já foi decidida (%)', v_approval.status using errcode = '55000';
  end if;

  if v_approval.expires_at <= now() then
    raise exception 'Esta aprovação expirou' using errcode = '55000';
  end if;

  if p_decision = 'aprovar' then
    if p_edited_payload is not null and jsonb_typeof(p_edited_payload) <> 'object' then
      raise exception 'Payload editado inválido' using errcode = '22023';
    end if;
    if v_approval.autonomy_level = 'sempre_aprovar' and p_channel = 'whatsapp' then
      raise exception 'Esta ação só pode ser aprovada no painel' using errcode = '42501';
    end if;
    v_new_status := case when p_edited_payload is null then 'aprovada' else 'editada' end;
  else
    if p_edited_payload is not null then
      raise exception 'Recusa não aceita payload editado' using errcode = '22023';
    end if;
    v_new_status := 'recusada';
  end if;

  update public.approvals
  set status = v_new_status,
      edited_payload = p_edited_payload,
      decided_by = auth.uid(),
      decided_at = now(),
      decision_channel = p_channel,
      decision_note = p_note
  where id = v_approval.id;

  -- Recusa devolve a tarefa ao orquestrador, que revisa ou encerra.
  if v_new_status = 'recusada' then
    update public.tasks t
    set status = 'a_fazer'
    where t.id = v_approval.task_id
      and t.org_id = v_approval.org_id
      and t.status = 'aguardando_aprovacao';
  end if;

  insert into public.audit_log (org_id, actor_type, actor_id, action, target, reason, task_id, payload_redacted)
  values (
    v_approval.org_id, 'usuario', auth.uid()::text, 'aprovacao.' || p_decision,
    'approval:' || v_approval.id, p_note, v_approval.task_id,
    jsonb_build_object('status', v_new_status, 'canal', p_channel, 'tipo', v_approval.action_type)
  );

  return v_new_status;
end;
$$;

revoke all on function public.decide_approval(uuid, text, jsonb, text, text) from public, anon;
grant execute on function public.decide_approval(uuid, text, jsonb, text, text) to authenticated;
