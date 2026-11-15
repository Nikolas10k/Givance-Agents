-- Fase 1c: Instagram da empresa.
--
-- * A conta conectada fica em connections (provider 'instagram'); o token, no Vault.
-- * Cada post pedido por um agente vira um registro em social_posts, ligado à aprovação
--   (instagram.publicar). A API do Instagram não agenda: o worker segura a execução até o
--   horário pedido e então publica.
-- * Mídias ganham dimensões, para o agente escolher o formato sem abrir o arquivo.

alter table public.media_assets
  add column width integer check (width is null or width > 0),
  add column height integer check (height is null or height > 0),
  add column duration_seconds numeric(8, 2) check (duration_seconds is null or duration_seconds >= 0);

create table public.social_posts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid not null,
  approval_id uuid not null unique,
  channel text not null default 'instagram' check (channel in ('instagram')),
  format text not null check (format in ('feed', 'carrossel', 'reels', 'story')),
  caption text not null default '' check (char_length(caption) <= 2200),
  media_ids uuid[] not null check (cardinality(media_ids) between 1 and 10),
  -- Recorte aplicado às imagens: 1:1, 4:5, 9:16 ou original (dentro dos limites do Instagram).
  crop text not null default 'original' check (crop in ('1:1', '4:5', '9:16', 'original')),
  status text not null default 'aguardando_confirmacao'
    check (status in ('aguardando_confirmacao', 'agendado', 'publicando', 'publicado', 'falhou', 'cancelado')),
  scheduled_at timestamptz,
  ig_container_id text check (char_length(ig_container_id) <= 100),
  ig_media_id text check (char_length(ig_media_id) <= 100),
  permalink text check (char_length(permalink) <= 500),
  error text check (char_length(error) <= 2000),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (task_id, org_id) references public.tasks (id, org_id) on delete cascade,
  foreign key (approval_id, org_id) references public.approvals (id, org_id) on delete cascade,
  check (status <> 'publicado' or (ig_media_id is not null and published_at is not null))
);

create index social_posts_org_created_idx on public.social_posts (org_id, created_at desc);
create index social_posts_task_idx on public.social_posts (task_id);

create trigger social_posts_updated_at before update on public.social_posts
  for each row execute function private.set_updated_at();

alter table public.social_posts enable row level security;

create policy "membros veem os posts" on public.social_posts
  for select to authenticated
  using (org_id in (select private.user_org_ids()) or (select private.is_givance_admin()));

-- Aprovação recusada, expirada ou cancelada: o post deixa de valer.
create or replace function private.cancel_social_post()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('recusada', 'expirada', 'cancelada') and old.status is distinct from new.status then
    update public.social_posts p
    set status = 'cancelado'
    where p.approval_id = new.id
      and p.org_id = new.org_id
      and p.status in ('aguardando_confirmacao', 'agendado');
  end if;
  return null;
end;
$$;

create trigger approvals_cancel_social_post after update of status on public.approvals
  for each row execute function private.cancel_social_post();

-- Envio de mídia pelo painel: o servidor gera uma URL assinada de upload (chave secreta) e
-- registra o arquivo depois de conferir que ele existe. Membros não escrevem no bucket.

-- Realtime do painel de posts.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.social_posts;
  end if;
end;
$$;
