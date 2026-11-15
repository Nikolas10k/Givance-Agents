import {
  ACTOR_TYPES,
  APPROVAL_STATUSES,
  AUTONOMY_LEVELS,
  CONNECTION_PROVIDERS,
  CONNECTION_STATUSES,
  DECISION_CHANNELS,
  EMPLOYEE_STATUSES,
  EXECUTION_STATUSES,
  MEMBERSHIP_ROLES,
  MESSAGE_AUTHORS,
  REGULATED_SECTORS,
  RISK_LEVELS,
  ROUTINE_KINDS,
  RUN_STATUSES,
  RUN_TRIGGERS,
  STEP_KINDS,
  STEP_STATUSES,
  TASK_SOURCES,
  TASK_STATUSES,
} from '@givance/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, type Db } from './helpers';

let db: Db;
beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db.end();
});

describe('estrutura de segurança do schema public', () => {
  it('toda tabela tem RLS ligado', async () => {
    const { rows } = await db.query<{ relname: string }>(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it('anon não tem nenhum privilégio em tabelas nem funções', async () => {
    const tabelas = await db.query(`
      select table_name, privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'anon'`);
    expect(tabelas.rows).toEqual([]);
    const funcoes = await db.query(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')`);
    expect(funcoes.rows).toEqual([]);
  });

  it('o usuário logado só escreve onde foi liberado explicitamente', async () => {
    const { rows } = await db.query<{ table_name: string; privilege_type: string }>(`
      select table_name, privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'authenticated' and privilege_type <> 'SELECT'
      order by 1, 2`);
    expect(rows.map((r) => `${r.table_name}:${r.privilege_type}`)).toEqual([
      'autonomy_policies:DELETE',
      'autonomy_policies:INSERT',
      'autonomy_policies:UPDATE',
      'company_profiles:INSERT',
      'company_profiles:UPDATE',
      'knowledge_documents:DELETE',
      'products:DELETE',
      'products:INSERT',
      'products:UPDATE',
    ]);
  });

  it('o usuário logado só executa as RPCs previstas', async () => {
    const { rows } = await db.query<{ proname: string }>(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      order by 1`);
    expect(rows.map((r) => r.proname)).toEqual([
      'create_task',
      'decide_approval',
      'search_knowledge',
      'start_channel_verification',
    ]);
  });

  it('funções security definer fixam o search_path', async () => {
    const { rows } = await db.query<{ fn: string }>(`
      select n.nspname || '.' || p.proname as fn
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and p.prosecdef
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`);
    expect(rows.map((r) => r.fn)).toEqual([]);
  });
});

describe('valores de domínio iguais no banco e no código', () => {
  const pares: Array<[string, string, readonly string[]]> = [
    ['tasks', 'status', TASK_STATUSES],
    ['tasks', 'source', TASK_SOURCES],
    ['employees', 'status', EMPLOYEE_STATUSES],
    ['approvals', 'status', APPROVAL_STATUSES],
    ['approvals', 'autonomy_level', AUTONOMY_LEVELS],
    ['approvals', 'risk_level', RISK_LEVELS],
    ['approvals', 'decision_channel', DECISION_CHANNELS],
    ['autonomy_policies', 'level', AUTONOMY_LEVELS],
    ['action_executions', 'status', EXECUTION_STATUSES],
    ['agent_runs', 'status', RUN_STATUSES],
    ['agent_runs', 'trigger', RUN_TRIGGERS],
    ['agent_steps', 'kind', STEP_KINDS],
    ['agent_steps', 'status', STEP_STATUSES],
    ['audit_log', 'actor_type', ACTOR_TYPES],
    ['connections', 'provider', CONNECTION_PROVIDERS],
    ['connections', 'status', CONNECTION_STATUSES],
    ['memberships', 'role', MEMBERSHIP_ROLES],
    ['messages', 'author', MESSAGE_AUTHORS],
    ['routines', 'kind', ROUTINE_KINDS],
    ['company_profiles', 'regulated_sector', REGULATED_SECTORS],
  ];

  it.each(pares)('%s.%s', async (tabela, coluna, valores) => {
    const { rows } = await db.query<{ def: string }>(
      `select pg_get_constraintdef(c.oid) as def
       from pg_constraint c
       join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
       where c.conrelid = $1::regclass and c.contype = 'c' and array_length(c.conkey, 1) = 1 and a.attname = $2`,
      [`public.${tabela}`, coluna],
    );
    expect(rows).toHaveLength(1);
    const noBanco = [...rows[0]!.def.matchAll(/'([^']+)'::text/g)].map((m) => m[1]).sort();
    expect(noBanco).toEqual([...valores].sort());
  });
});
