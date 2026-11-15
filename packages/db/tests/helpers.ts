import pg from 'pg';

/** Banco local do Supabase CLI (supabase start). Em CI, o mesmo endereço. */
export const DB_URL =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/** IDs fixos do seed (supabase/seeds). */
export const USERS = {
  givance: '10000000-0000-4000-8000-000000000001',
  clinicaDona: '10000000-0000-4000-8000-000000000002',
  clinicaRecepcao: '10000000-0000-4000-8000-000000000003',
  padariaDono: '10000000-0000-4000-8000-000000000004',
} as const;

export const ORGS = {
  givance: '20000000-0000-4000-8000-000000000001',
  clinica: '20000000-0000-4000-8000-000000000002',
  padaria: '20000000-0000-4000-8000-000000000003',
} as const;

export type Db = pg.Client;

export async function connect(): Promise<Db> {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  return client;
}

/** Roda `fn` numa transação que sempre é desfeita: os testes não alteram o seed. */
export async function inRollback<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  await db.query('begin');
  try {
    return await fn();
  } finally {
    await db.query('rollback');
  }
}

/** Passa a agir como um usuário logado (role authenticated + claims do JWT). */
export async function actAs(db: Db, userId: string, appMetadata: Record<string, unknown> = {}) {
  await db.query('reset role');
  await db.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: userId, role: 'authenticated', app_metadata: appMetadata }),
  ]);
  await db.query('set local role authenticated');
}

export async function actAsService(db: Db) {
  await db.query('reset role');
  await db.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ role: 'service_role' }),
  ]);
  await db.query('set local role service_role');
}

export async function actAsAnon(db: Db) {
  await db.query('reset role');
  await db.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ role: 'anon' }),
  ]);
  await db.query('set local role anon');
}

/** Volta para o papel do dono do banco (postgres), para montar dados de teste. */
export async function actAsOwner(db: Db) {
  await db.query('reset role');
}

/** Executa uma consulta que deve falhar, sem abortar a transação do teste. */
export async function expectDbError(db: Db, sql: string, params: unknown[] = []): Promise<string> {
  await db.query('savepoint esperando_erro');
  try {
    await db.query(sql, params);
  } catch (error) {
    await db.query('rollback to savepoint esperando_erro');
    return error instanceof Error ? error.message : String(error);
  }
  await db.query('release savepoint esperando_erro');
  throw new Error(`Esperava erro e a consulta funcionou: ${sql}`);
}

/** Cria, como dono do banco, uma tarefa (e opcionalmente uma aprovação) para uma empresa. */
export async function createFixtureTask(
  db: Db,
  orgId: string,
  status = 'em_andamento',
): Promise<{ taskId: string; employeeId: string }> {
  const { rows } = await db.query<{ id: string }>(
    'select id from employees where org_id = $1 limit 1',
    [orgId],
  );
  const employeeId = rows[0]!.id;
  const task = await db.query<{ id: string }>(
    `insert into tasks (org_id, employee_id, title, status, source) values ($1, $2, 'Tarefa de teste', $3, 'sistema') returning id`,
    [orgId, employeeId, status],
  );
  return { taskId: task.rows[0]!.id, employeeId };
}

export async function createFixtureApproval(
  db: Db,
  orgId: string,
  taskId: string,
  extra: { level?: string; expiresAt?: string; key?: string } = {},
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into approvals (org_id, task_id, action_type, payload, autonomy_level, requested_by_agent, idempotency_key, expires_at)
     values ($1, $2, 'memoria.registrar', '{"titulo":"Teste","conteudo":"Conteúdo de teste"}', $3, 'orquestrador', $4, coalesce($5::timestamptz, now() + interval '72 hours'))
     returning id`,
    [
      orgId,
      taskId,
      extra.level ?? 'confirmar',
      extra.key ?? `acao:teste-${crypto.randomUUID()}`,
      extra.expiresAt ?? null,
    ],
  );
  return rows[0]!.id;
}

export async function queueCount(
  db: Db,
  queue: 'tarefas' | 'acoes' | 'rotinas',
  field: string,
  value: string,
) {
  const { rows } = await db.query<{ n: string }>(
    `select count(*)::text as n from pgmq.q_${queue} where message ->> $1 = $2`,
    [field, value],
  );
  return Number(rows[0]!.n);
}
