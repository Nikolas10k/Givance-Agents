-- Empresas (tenants), membros, perfil da empresa e produtos.

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  timezone text not null default 'America/Sao_Paulo',
  currency text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  -- Teto de gasto diário com anúncios, em centavos. Lido pelas ferramentas (Fase 2).
  daily_budget_cap_cents bigint not null default 0 check (daily_budget_cap_cents >= 0),
  -- Teto mensal de custo com modelos (USD). Nulo = sem teto além do plano.
  monthly_cost_cap_usd numeric(12, 4) check (monthly_cost_cap_usd is null or monthly_cost_cap_usd > 0),
  status text not null default 'ativa' check (status in ('ativa', 'suspensa', 'encerrada')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger organizations_updated_at before update on public.organizations
  for each row execute function private.set_updated_at();

create table public.memberships (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create index memberships_user_id_idx on public.memberships (user_id);

-- Empresas de que o usuário logado faz parte. security definer para poder ler memberships
-- sem cair na própria política de RLS (evita recursão).
create or replace function private.user_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.org_id from public.memberships m where m.user_id = (select auth.uid());
$$;

-- Empresas em que o usuário logado tem um dos papéis informados.
create or replace function private.user_org_ids_with_role(p_roles text[])
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.org_id
  from public.memberships m
  where m.user_id = (select auth.uid()) and m.role = any (p_roles);
$$;

revoke all on function private.user_org_ids() from public;
revoke all on function private.user_org_ids_with_role(text[]) from public;
grant execute on function private.user_org_ids() to authenticated, service_role;
grant execute on function private.user_org_ids_with_role(text[]) to authenticated, service_role;

alter table public.organizations enable row level security;
alter table public.memberships enable row level security;

create policy "membros leem a própria empresa" on public.organizations
  for select to authenticated
  using (id in (select private.user_org_ids()) or (select private.is_givance_admin()));

create policy "dono e admin atualizam a empresa" on public.organizations
  for update to authenticated
  using (id in (select private.user_org_ids_with_role(array['owner', 'admin'])))
  with check (id in (select private.user_org_ids_with_role(array['owner', 'admin'])));

-- O dono pode ajustar nome, fuso e tetos. Status da empresa só a Givance altera.
grant update (name, timezone, daily_budget_cap_cents, monthly_cost_cap_usd)
  on public.organizations to authenticated;

create policy "membros veem a equipe da empresa" on public.memberships
  for select to authenticated
  using (org_id in (select private.user_org_ids()) or (select private.is_givance_admin()));

-- Perfil da empresa: alimenta o bloco de contexto de todos os agentes.
create table public.company_profiles (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  description text check (char_length(description) <= 4000),
  segment text check (char_length(segment) <= 200),
  tone_of_voice text check (char_length(tone_of_voice) <= 2000),
  regions text[] not null default '{}',
  do_not_say text[] not null default '{}',
  regulated_sector text check (regulated_sector in ('saude', 'financeiro', 'juridico', 'educacao', 'outro')),
  special_ad_categories text[] not null default '{}',
  website_url text check (website_url ~ '^https?://'),
  instagram_handle text check (instagram_handle ~ '^[A-Za-z0-9._]{1,30}$'),
  business_hours text check (char_length(business_hours) <= 500),
  updated_at timestamptz not null default now()
);

create trigger company_profiles_updated_at before update on public.company_profiles
  for each row execute function private.set_updated_at();

alter table public.company_profiles enable row level security;

create policy "membros leem o perfil" on public.company_profiles
  for select to authenticated
  using (org_id in (select private.user_org_ids()) or (select private.is_givance_admin()));

create policy "dono e admin criam o perfil" on public.company_profiles
  for insert to authenticated
  with check (org_id in (select private.user_org_ids_with_role(array['owner', 'admin'])));

create policy "dono e admin editam o perfil" on public.company_profiles
  for update to authenticated
  using (org_id in (select private.user_org_ids_with_role(array['owner', 'admin'])))
  with check (org_id in (select private.user_org_ids_with_role(array['owner', 'admin'])));

grant insert, update on public.company_profiles to authenticated;

create table public.products (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  description text check (char_length(description) <= 2000),
  price_cents bigint check (price_cents is null or price_cents >= 0),
  -- Preço público pode aparecer em posts e respostas; preço interno não.
  price_is_public boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index products_org_id_idx on public.products (org_id);

create trigger products_updated_at before update on public.products
  for each row execute function private.set_updated_at();

alter table public.products enable row level security;

create policy "membros leem produtos" on public.products
  for select to authenticated
  using (org_id in (select private.user_org_ids()) or (select private.is_givance_admin()));

create policy "dono e admin criam produtos" on public.products
  for insert to authenticated
  with check (org_id in (select private.user_org_ids_with_role(array['owner', 'admin'])));

create policy "dono e admin editam produtos" on public.products
  for update to authenticated
  using (org_id in (select private.user_org_ids_with_role(array['owner', 'admin'])))
  with check (org_id in (select private.user_org_ids_with_role(array['owner', 'admin'])));

create policy "dono e admin removem produtos" on public.products
  for delete to authenticated
  using (org_id in (select private.user_org_ids_with_role(array['owner', 'admin'])));

grant insert, update, delete on public.products to authenticated;
