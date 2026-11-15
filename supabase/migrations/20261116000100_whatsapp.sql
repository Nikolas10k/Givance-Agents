-- Fase 1b: canal WhatsApp do dono.
--
-- * Verificação do número: o dono pede um código no painel e manda esse código para o número
--   da Givance pelo WhatsApp. Isso prova que o número é dele e abre a janela de 24h.
-- * Mensagens recebidas entram na fila "whatsapp_entrada" (o webhook só valida e enfileira).
-- * Mensagens para o dono e prévias de aprovação saem pela fila "whatsapp_saida".
-- * Decisões por botão usam decide_approval_as (o webhook não tem o JWT do dono).

select pgmq.create('whatsapp_entrada');
select pgmq.create('whatsapp_saida');

create or replace function private.assert_known_queue(p_queue text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_queue is null
    or p_queue not in ('tarefas', 'acoes', 'rotinas', 'whatsapp_entrada', 'whatsapp_saida') then
    raise exception 'Fila desconhecida: %', p_queue using errcode = '22023';
  end if;
end;
$$;

-- Canal: código de verificação (só o hash) e edição pendente pedida pelo botão "Editar".
alter table public.channels
  add column verification_code_hash text,
  add column verification_expires_at timestamptz,
  add column pending_edit_approval_id uuid;

-- Mensagens: id da mensagem no WhatsApp (wamid), para respostas citando uma mensagem.
alter table public.messages
  add column external_id text check (char_length(external_id) <= 200),
  add column delivery_error text check (char_length(delivery_error) <= 2000);

-- Conversa pelo WhatsApp: com qual número (canal) ela acontece.
alter table public.conversations
  add column channel_id uuid,
  add constraint conversations_channel_fk foreign key (channel_id, org_id)
    references public.channels (id, org_id) on delete set null (channel_id);

-- Aprovação: id da prévia com botões enviada (nulo = ainda não mostrada no WhatsApp).
alter table public.approvals add column preview_message_id text;

create index messages_external_id_idx on public.messages (org_id, external_id) where external_id is not null;

-- Mensagens recebidas já processadas (o WhatsApp pode reenviar o mesmo evento).
create table private.whatsapp_inbound (
  wa_message_id text primary key,
  received_at timestamptz not null default now()
);

revoke all on table private.whatsapp_inbound from public, anon, authenticated;

create or replace function public.whatsapp_inbound_claim(p_wa_message_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.whatsapp_inbound (wa_message_id) values (p_wa_message_id)
  on conflict do nothing;
  return found;
end;
$$;

revoke all on function public.whatsapp_inbound_claim(text) from public, anon, authenticated;
grant execute on function public.whatsapp_inbound_claim(text) to service_role;

-- Mídias da empresa (fotos e vídeos recebidos pelo WhatsApp ou enviados no painel).
create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  storage_path text not null unique check (char_length(storage_path) <= 500),
  mime_type text not null check (char_length(mime_type) <= 100),
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  source text not null check (source in ('whatsapp', 'upload')),
  external_id text check (char_length(external_id) <= 200),
  caption text check (char_length(caption) <= 2000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, org_id)
);

create index media_assets_org_idx on public.media_assets (org_id, created_at desc);

alter table public.media_assets enable row level security;

create policy "membros veem as mídias" on public.media_assets
  for select to authenticated
  using (org_id in (select private.user_org_ids()) or (select private.is_givance_admin()));

-- Bucket privado. Caminho: <org_id>/<arquivo>. Leitura para membros; escrita pelo worker.
insert into storage.buckets (id, name, public)
values ('midia', 'midia', false)
on conflict (id) do nothing;

create policy "membros leem mídias da empresa" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'midia'
    and (storage.foldername(name))[1]::uuid in (select private.user_org_ids())
  );

-- Decisão de aprovação com o usuário explícito. A versão do painel usa auth.uid().
create or replace function private.decide_approval_core(
  p_user_id uuid,
  p_approval_id uuid,
  p_decision text,
  p_edited_payload jsonb,
  p_note text,
  p_channel text
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

  if not found or p_user_id is null or not exists (
    select 1 from public.memberships m
    where m.org_id = v_approval.org_id and m.user_id = p_user_id and m.role in ('owner', 'admin')
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
      decided_by = p_user_id,
      decided_at = now(),
      decision_channel = p_channel,
      decision_note = p_note
  where id = v_approval.id;

  if v_new_status = 'recusada' then
    update public.tasks t
    set status = 'a_fazer'
    where t.id = v_approval.task_id
      and t.org_id = v_approval.org_id
      and t.status = 'aguardando_aprovacao';
  end if;

  insert into public.audit_log (org_id, actor_type, actor_id, action, target, reason, task_id, payload_redacted)
  values (
    v_approval.org_id, 'usuario', p_user_id::text, 'aprovacao.' || p_decision,
    'approval:' || v_approval.id, p_note, v_approval.task_id,
    jsonb_build_object('status', v_new_status, 'canal', p_channel, 'tipo', v_approval.action_type)
  );

  return v_new_status;
end;
$$;

revoke all on function private.decide_approval_core(uuid, uuid, text, jsonb, text, text) from public;

create or replace function public.decide_approval(
  p_approval_id uuid,
  p_decision text,
  p_edited_payload jsonb default null,
  p_note text default null,
  p_channel text default 'painel'
)
returns text
language sql
security definer
set search_path = ''
as $$
  select private.decide_approval_core(auth.uid(), p_approval_id, p_decision, p_edited_payload, p_note, p_channel);
$$;

-- Usada pelo worker quando o dono decide por botão no WhatsApp (canal verificado).
create or replace function public.decide_approval_as(
  p_user_id uuid,
  p_approval_id uuid,
  p_decision text,
  p_note text default null
)
returns text
language sql
security definer
set search_path = ''
as $$
  select private.decide_approval_core(p_user_id, p_approval_id, p_decision, null, p_note, 'whatsapp');
$$;

revoke all on function public.decide_approval_as(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.decide_approval_as(uuid, uuid, text, text) to service_role;

-- O dono pede um código para ligar o próprio WhatsApp à empresa. Devolve o código (6 dígitos),
-- válido por 15 minutos; só o hash fica salvo.
create or replace function public.start_channel_verification(p_org_id uuid, p_address text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_address text := regexp_replace(coalesce(p_address, ''), '[^0-9+]', '', 'g');
  v_code text;
begin
  if v_user is null or not exists (
    select 1 from public.memberships m where m.org_id = p_org_id and m.user_id = v_user
  ) then
    raise exception 'Empresa não encontrada' using errcode = 'P0002';
  end if;

  if left(v_address, 1) <> '+' then
    v_address := '+55' || v_address;
  end if;
  if v_address !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Número inválido. Use o formato com DDD, ex.: (19) 99999-0000.' using errcode = '22023';
  end if;

  v_code := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');

  insert into public.channels (org_id, user_id, kind, address_e164, verified_at, verification_code_hash, verification_expires_at)
  values (
    p_org_id, v_user, 'whatsapp', v_address, null,
    encode(extensions.digest(v_code, 'sha256'), 'hex'), now() + interval '15 minutes'
  )
  on conflict (org_id, kind, address_e164) do update
  set user_id = excluded.user_id,
      verified_at = null,
      verification_code_hash = excluded.verification_code_hash,
      verification_expires_at = excluded.verification_expires_at;

  insert into public.audit_log (org_id, actor_type, actor_id, action, target)
  values (p_org_id, 'usuario', v_user::text, 'canal.verificacao_iniciada', 'whatsapp');

  return v_code;
end;
$$;

revoke all on function public.start_channel_verification(uuid, text) from public, anon;
grant execute on function public.start_channel_verification(uuid, text) to authenticated;

-- O worker confirma o código recebido do número. Devolve o canal verificado, se bater.
create or replace function public.confirm_channel_verification(p_address text, p_code text)
returns table (channel_id uuid, org_id uuid, user_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.channels c
  set verified_at = now(),
      last_inbound_at = now(),
      verification_code_hash = null,
      verification_expires_at = null
  where c.kind = 'whatsapp'
    and c.address_e164 = p_address
    and c.verification_code_hash = encode(extensions.digest(p_code, 'sha256'), 'hex')
    and c.verification_expires_at > now()
  returning c.id, c.org_id, c.user_id;
end;
$$;

revoke all on function public.confirm_channel_verification(text, text) from public, anon, authenticated;
grant execute on function public.confirm_channel_verification(text, text) to service_role;

-- Mensagem para o dono numa conversa de WhatsApp -> fila de saída, na mesma transação.
create or replace function private.enqueue_whatsapp_delivery()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.delivery_status = 'pendente' then
    perform pgmq.send(
      'whatsapp_saida',
      jsonb_build_object('type', 'message.deliver', 'message_id', new.id, 'org_id', new.org_id)
    );
  end if;
  return null;
end;
$$;

create trigger messages_enqueue_whatsapp after insert on public.messages
  for each row execute function private.enqueue_whatsapp_delivery();

-- Aprovação pendente -> prévia com botões no WhatsApp do dono (o worker decide se há canal).
create or replace function private.enqueue_approval_notice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'pendente' then
    perform pgmq.send(
      'whatsapp_saida',
      jsonb_build_object('type', 'approval.notify', 'approval_id', new.id, 'org_id', new.org_id)
    );
  end if;
  return null;
end;
$$;

create trigger approvals_notify_whatsapp after insert on public.approvals
  for each row execute function private.enqueue_approval_notice();
