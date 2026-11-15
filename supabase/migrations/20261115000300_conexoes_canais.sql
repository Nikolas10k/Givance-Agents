-- Conexões com contas externas (Meta, Instagram, WhatsApp, Google) e canais do dono.
-- Tokens OAuth nunca ficam em tabela: vão para o Supabase Vault, e só o worker os lê.

create table public.connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  provider text not null check (provider in ('meta', 'instagram', 'whatsapp', 'google')),
  label text not null default 'principal' check (char_length(label) between 1 and 100),
  -- IDs externos: conta de anúncio, página, conta do Instagram, WABA, e-mail Google etc.
  external_ids jsonb not null default '{}'::jsonb check (jsonb_typeof(external_ids) = 'object'),
  scopes text[] not null default '{}',
  status text not null default 'ativa' check (status in ('ativa', 'expirada', 'revogada', 'erro')),
  expires_at timestamptz,
  last_error text check (char_length(last_error) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, provider, label),
  unique (id, org_id)
);

create trigger connections_updated_at before update on public.connections
  for each row execute function private.set_updated_at();

alter table public.connections enable row level security;

create policy "membros veem as conexões" on public.connections
  for select to authenticated
  using (org_id in (select private.user_org_ids()) or (select private.is_givance_admin()));

-- Referência ao segredo no Vault. Fica no schema private: não é exposta pela API e
-- nenhum usuário logado tem acesso.
create table private.connection_secrets (
  connection_id uuid primary key references public.connections (id) on delete cascade,
  vault_secret_id uuid not null,
  updated_at timestamptz not null default now()
);

revoke all on table private.connection_secrets from public, anon, authenticated;

-- Ao remover a referência (inclusive em cascata, quando a conexão ou a empresa é apagada),
-- apaga também o segredo no Vault.
create or replace function private.delete_vault_secret()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets s where s.id = old.vault_secret_id;
  return old;
end;
$$;

create trigger connection_secrets_delete_vault after delete on private.connection_secrets
  for each row execute function private.delete_vault_secret();

-- Grava ou substitui o token de uma conexão. Só o worker e o servidor (chave secreta).
create or replace function public.connection_secret_set(p_connection_id uuid, p_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
begin
  if p_secret is null or length(p_secret) = 0 then
    raise exception 'Segredo vazio' using errcode = '22023';
  end if;

  if not exists (select 1 from public.connections c where c.id = p_connection_id) then
    raise exception 'Conexão não encontrada' using errcode = 'P0002';
  end if;

  select cs.vault_secret_id into v_secret_id
  from private.connection_secrets cs
  where cs.connection_id = p_connection_id
  for update;

  if v_secret_id is null then
    v_secret_id := vault.create_secret(
      p_secret,
      'connection:' || p_connection_id::text,
      'Credencial de conexão externa'
    );
    insert into private.connection_secrets (connection_id, vault_secret_id)
    values (p_connection_id, v_secret_id);
  else
    perform vault.update_secret(v_secret_id, p_secret);
    update private.connection_secrets set updated_at = now() where connection_id = p_connection_id;
  end if;
end;
$$;

create or replace function public.connection_secret_get(p_connection_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select ds.decrypted_secret
  from private.connection_secrets cs
  join vault.decrypted_secrets ds on ds.id = cs.vault_secret_id
  where cs.connection_id = p_connection_id;
$$;

revoke all on function public.connection_secret_set(uuid, text) from public, anon, authenticated;
revoke all on function public.connection_secret_get(uuid) from public, anon, authenticated;
grant execute on function public.connection_secret_set(uuid, text) to service_role;
grant execute on function public.connection_secret_get(uuid) to service_role;

-- Canal do dono (WhatsApp): por onde ele dá comandos e recebe prévias e avisos.
create table public.channels (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null,
  kind text not null default 'whatsapp' check (kind in ('whatsapp')),
  address_e164 text not null check (address_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  -- Só números verificados podem dar comandos.
  verified_at timestamptz,
  -- Última mensagem recebida do dono: diz se a janela de 24h do WhatsApp está aberta.
  last_inbound_at timestamptz,
  -- Horário de silêncio, ex.: {"inicio": "22:00", "fim": "07:00"}.
  quiet_hours jsonb check (quiet_hours is null or jsonb_typeof(quiet_hours) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, kind, address_e164),
  unique (id, org_id),
  -- O dono do canal precisa ser membro da empresa.
  foreign key (org_id, user_id) references public.memberships (org_id, user_id) on delete cascade
);

create index channels_address_idx on public.channels (kind, address_e164);

create trigger channels_updated_at before update on public.channels
  for each row execute function private.set_updated_at();

alter table public.channels enable row level security;

create policy "cada um vê o próprio canal; dono e admin veem todos" on public.channels
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or org_id in (select private.user_org_ids_with_role(array['owner', 'admin']))
    or (select private.is_givance_admin())
  );
