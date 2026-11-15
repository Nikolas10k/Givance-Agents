-- Memória da empresa (RAG): documentos, trechos com busca textual em português e vetores.
-- Os embeddings (Voyage, 1024 dimensões) entram quando o provedor for configurado; até lá a
-- busca funciona só pelo texto.

create table public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  source text not null check (source in ('manual', 'upload', 'site', 'instagram', 'decisao')),
  storage_path text check (char_length(storage_path) <= 1000),
  status text not null default 'pendente' check (status in ('pendente', 'processado', 'falhou')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id)
);

create index knowledge_documents_org_idx on public.knowledge_documents (org_id);

create trigger knowledge_documents_updated_at before update on public.knowledge_documents
  for each row execute function private.set_updated_at();

create table public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  document_id uuid not null,
  chunk_index integer not null check (chunk_index >= 0),
  content text not null check (char_length(content) between 1 and 8000),
  content_tsv tsvector generated always as (to_tsvector('portuguese'::regconfig, content)) stored,
  embedding extensions.vector(1024),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index),
  foreign key (document_id, org_id) references public.knowledge_documents (id, org_id) on delete cascade
);

create index knowledge_chunks_org_idx on public.knowledge_chunks (org_id);
create index knowledge_chunks_tsv_idx on public.knowledge_chunks using gin (content_tsv);
create index knowledge_chunks_embedding_idx on public.knowledge_chunks
  using hnsw (embedding extensions.vector_cosine_ops);

alter table public.knowledge_documents enable row level security;
alter table public.knowledge_chunks enable row level security;

create policy "membros leem documentos" on public.knowledge_documents
  for select to authenticated
  using (org_id in (select private.user_org_ids()) or (select private.is_givance_admin()));

create policy "dono e admin criam documentos" on public.knowledge_documents
  for insert to authenticated
  with check (org_id in (select private.user_org_ids_with_role(array['owner', 'admin'])));

create policy "dono e admin removem documentos" on public.knowledge_documents
  for delete to authenticated
  using (org_id in (select private.user_org_ids_with_role(array['owner', 'admin'])));

grant insert (org_id, title, source, storage_path, created_by), delete
  on public.knowledge_documents to authenticated;

create policy "membros leem trechos" on public.knowledge_chunks
  for select to authenticated
  using (org_id in (select private.user_org_ids()) or (select private.is_givance_admin()));

-- Busca híbrida (texto + vetor) com fusão por posição (reciprocal rank fusion).
-- security invoker: para o usuário logado vale o RLS; o worker sempre informa p_org_id.
create or replace function public.search_knowledge(
  p_org_id uuid,
  p_query text,
  p_query_embedding extensions.vector(1024) default null,
  p_limit integer default 8
)
returns table (chunk_id uuid, document_id uuid, title text, content text, score double precision)
language sql
stable
security invoker
set search_path = ''
as $$
  with consulta as (
    select websearch_to_tsquery('portuguese'::regconfig, coalesce(p_query, '')) as q
  ),
  por_texto as (
    select c.id, row_number() over (order by ts_rank_cd(c.content_tsv, consulta.q) desc) as posicao
    from public.knowledge_chunks c, consulta
    where c.org_id = p_org_id and c.content_tsv @@ consulta.q
    order by posicao
    limit 50
  ),
  por_vetor as (
    select c.id,
      row_number() over (order by c.embedding operator(extensions.<=>) p_query_embedding) as posicao
    from public.knowledge_chunks c
    where p_query_embedding is not null and c.org_id = p_org_id and c.embedding is not null
    order by posicao
    limit 50
  ),
  fundido as (
    select coalesce(t.id, v.id) as id,
      coalesce(1.0 / (60 + t.posicao), 0) + coalesce(1.0 / (60 + v.posicao), 0) as score
    from por_texto t
    full outer join por_vetor v on v.id = t.id
  )
  select c.id, c.document_id, d.title, c.content, f.score::double precision
  from fundido f
  join public.knowledge_chunks c on c.id = f.id
  join public.knowledge_documents d on d.id = c.document_id
  order by f.score desc
  limit least(greatest(coalesce(p_limit, 8), 1), 20);
$$;

revoke all on function public.search_knowledge(uuid, text, extensions.vector, integer) from public, anon;
grant execute on function public.search_knowledge(uuid, text, extensions.vector, integer)
  to authenticated, service_role;
