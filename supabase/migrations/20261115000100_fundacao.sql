-- Fundação: extensões, schema privado e permissões padrão seguras.
--
-- Convenções usadas em todas as migrations:
-- * Toda tabela com dados de cliente tem org_id e RLS ligado.
-- * Tabelas filhas referenciam o pai por (id, org_id). Assim o banco impede que um registro
--   de uma empresa aponte para um registro de outra, mesmo quando quem escreve é o worker.
-- * Funções auxiliares ficam no schema "private", que não é exposto pela API.
-- * O usuário logado (role authenticated) só lê via RLS. Escritas sensíveis passam por
--   funções RPC com checagem explícita de empresa e papel.

create extension if not exists vector with schema extensions;
create extension if not exists pgmq;
create extension if not exists pg_cron;
create extension if not exists supabase_vault;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- Objetos novos no schema public não ficam acessíveis para anon, e o usuário logado não
-- recebe permissão de escrita por padrão. Cada tabela ou função libera explicitamente o
-- que precisa.
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate, references, trigger on tables from authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

-- Atualiza a coluna updated_at em qualquer tabela que a tenha.
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Verdadeiro quando o JWT do usuário traz app_metadata.givance_admin = true.
-- app_metadata só pode ser alterado com a chave secreta, nunca pelo próprio usuário.
create or replace function private.is_givance_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' -> 'givance_admin') = 'true'::jsonb, false);
$$;

revoke all on function private.is_givance_admin() from public;
grant execute on function private.is_givance_admin() to authenticated, service_role;
