import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  actAs,
  actAsAnon,
  actAsOwner,
  connect,
  createFixtureApproval,
  createFixtureTask,
  expectDbError,
  inRollback,
  ORGS,
  USERS,
  type Db,
} from './helpers';

let db: Db;
beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db.end();
});

/** Cria, para a Clínica e para a Padaria, um registro em cada tabela que ainda não tem seed. */
async function preencherTodasAsTabelas() {
  await actAsOwner(db);
  for (const org of [ORGS.clinica, ORGS.padaria]) {
    const { taskId, employeeId } = await createFixtureTask(db, org);
    const approvalId = await createFixtureApproval(db, org, taskId);
    const run = await db.query<{ id: string }>(
      `insert into agent_runs (org_id, task_id, run_number, trigger) values ($1, $2, 1, 'inicio') returning id`,
      [org, taskId],
    );
    const runId = run.rows[0]!.id;
    await db.query(
      `insert into agent_steps (org_id, run_id, agent, kind, tool_name) values ($1, $2, 'orquestrador', 'tool_call', 'memoria_buscar')`,
      [org, runId],
    );
    await db.query(
      `insert into artifacts (org_id, task_id, kind, title, data, created_by_agent) values ($1, $2, 'texto', 'Teste', '{}', 'copywriter')`,
      [org, taskId],
    );
    await db.query(`insert into action_executions (org_id, approval_id) values ($1, $2)`, [
      org,
      approvalId,
    ]);
    const conversa = await db.query<{ id: string }>(
      `insert into conversations (org_id, employee_id) values ($1, $2) returning id`,
      [org, employeeId],
    );
    await db.query(
      `insert into messages (org_id, conversation_id, author, content) values ($1, $2, 'dono', 'Olá')`,
      [org, conversa.rows[0]!.id],
    );
    await db.query(`insert into connections (org_id, provider) values ($1, 'instagram')`, [org]);
    await db.query(
      `insert into usage_ledger (org_id, period, employee_id, cost_usd) values ($1, date_trunc('month', now())::date, $2, 1)`,
      [org, employeeId],
    );
    const midia = await db.query<{ id: string }>(
      `insert into media_assets (org_id, storage_path, mime_type, source) values ($1, $2, 'image/jpeg', 'whatsapp') returning id`,
      [org, `${org}/foto.jpg`],
    );
    await db.query(
      `insert into social_posts (org_id, task_id, approval_id, format, caption, media_ids) values ($1, $2, $3, 'feed', 'Teste', array[$4::uuid])`,
      [org, taskId, approvalId, midia.rows[0]!.id],
    );
  }
  // A Padaria não tem canal nem política de autonomia no seed.
  await db.query(
    `insert into channels (org_id, user_id, address_e164) values ($1, $2, '+5511900000009')`,
    [ORGS.padaria, USERS.padariaDono],
  );
  await db.query(
    `insert into autonomy_policies (org_id, action_type, level) values ($1, 'memoria.registrar', 'automatico')`,
    [ORGS.padaria],
  );
  const documento = await db.query<{ id: string }>(
    `insert into knowledge_documents (org_id, title, source) values ($1, 'Encomendas', 'manual') returning id`,
    [ORGS.padaria],
  );
  await db.query(
    `insert into knowledge_chunks (org_id, document_id, chunk_index, content) values ($1, $2, 0, 'Encomendas com 48 horas de antecedência.')`,
    [ORGS.padaria, documento.rows[0]!.id],
  );
}

async function tabelasComOrgId(): Promise<string[]> {
  const { rows } = await db.query<{ table_name: string }>(`
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'org_id'
    order by table_name`);
  return rows.map((r) => r.table_name);
}

describe('isolamento entre empresas', () => {
  it('cada dono só enxerga linhas da própria empresa, em todas as tabelas', async () => {
    await inRollback(db, async () => {
      await preencherTodasAsTabelas();
      const tabelas = await tabelasComOrgId();
      expect(tabelas.length).toBeGreaterThanOrEqual(20);

      for (const [usuario, empresa] of [
        [USERS.clinicaDona, ORGS.clinica],
        [USERS.padariaDono, ORGS.padaria],
      ] as const) {
        await actAs(db, usuario);
        for (const tabela of tabelas) {
          const { rows } = await db.query<{ org_id: string }>(
            `select distinct org_id from public.${tabela}`,
          );
          const orgs = rows.map((r) => r.org_id);
          expect({ tabela, orgs }).toEqual({ tabela, orgs: [empresa] });
        }
        const empresas = await db.query<{ id: string }>('select id from organizations');
        expect(empresas.rows.map((r) => r.id)).toEqual([empresa]);
      }
    });
  });

  it('anon não lê nada', async () => {
    await inRollback(db, async () => {
      await actAsAnon(db);
      const erro = await expectDbError(db, 'select * from organizations');
      expect(erro).toMatch(/permission denied/);
    });
  });

  it('admin da Givance (claim no app_metadata) lê todas as empresas; sem o claim, só a própria', async () => {
    await inRollback(db, async () => {
      await actAs(db, USERS.givance, { givance_admin: true });
      const todas = await db.query('select id from organizations');
      expect(todas.rowCount).toBe(3);

      await actAs(db, USERS.givance);
      const propria = await db.query<{ id: string }>('select id from organizations');
      expect(propria.rows.map((r) => r.id)).toEqual([ORGS.givance]);
    });
  });

  it('não é possível ligar registros de empresas diferentes, nem com acesso total', async () => {
    await inRollback(db, async () => {
      await actAsOwner(db);
      const { rows } = await db.query<{ id: string }>(
        'select id from employees where org_id = $1',
        [ORGS.padaria],
      );
      const erro = await expectDbError(
        db,
        `insert into tasks (org_id, employee_id, title, source) values ($1, $2, 'Cruzada', 'sistema')`,
        [ORGS.clinica, rows[0]!.id],
      );
      expect(erro).toMatch(/foreign key/);
    });
  });
});

describe('escritas do usuário logado', () => {
  it('não grava tarefas nem aprovações diretamente', async () => {
    await inRollback(db, async () => {
      await actAsOwner(db);
      const { taskId, employeeId } = await createFixtureTask(db, ORGS.clinica);
      const approvalId = await createFixtureApproval(db, ORGS.clinica, taskId);

      await actAs(db, USERS.clinicaDona);
      expect(
        await expectDbError(
          db,
          `insert into tasks (org_id, employee_id, title, source) values ($1, $2, 'x', 'painel')`,
          [ORGS.clinica, employeeId],
        ),
      ).toMatch(/permission denied/);
      expect(
        await expectDbError(db, `update approvals set status = 'aprovada' where id = $1`, [
          approvalId,
        ]),
      ).toMatch(/permission denied/);
      expect(await expectDbError(db, `delete from audit_log`)).toMatch(/permission denied/);
    });
  });

  it('o dono ajusta nome e tetos, mas não o status da empresa', async () => {
    await inRollback(db, async () => {
      await actAs(db, USERS.clinicaDona);
      const ok = await db.query(
        `update organizations set name = 'Clínica Exemplo Ltda' where id = $1`,
        [ORGS.clinica],
      );
      expect(ok.rowCount).toBe(1);
      expect(
        await expectDbError(db, `update organizations set status = 'suspensa' where id = $1`, [
          ORGS.clinica,
        ]),
      ).toMatch(/permission denied/);
    });
  });

  it('membro sem papel de gestão não altera dados da empresa', async () => {
    await inRollback(db, async () => {
      await actAs(db, USERS.clinicaRecepcao);
      const nada = await db.query(`update organizations set name = 'Invadido' where id = $1`, [
        ORGS.clinica,
      ]);
      expect(nada.rowCount).toBe(0);
      expect(
        await expectDbError(db, `insert into products (org_id, name) values ($1, 'Produto')`, [
          ORGS.clinica,
        ]),
      ).toMatch(/row-level security/);
    });
  });

  it('dono de uma empresa não escreve em outra', async () => {
    await inRollback(db, async () => {
      await actAs(db, USERS.padariaDono);
      expect(
        await expectDbError(db, `insert into products (org_id, name) values ($1, 'Intruso')`, [
          ORGS.clinica,
        ]),
      ).toMatch(/row-level security/);
      const nada = await db.query(`update products set name = 'Intruso' where org_id = $1`, [
        ORGS.clinica,
      ]);
      expect(nada.rowCount).toBe(0);
    });
  });

  it('cargos, contratação, filas e segredos não são acessíveis ao usuário logado', async () => {
    await inRollback(db, async () => {
      await actAs(db, USERS.clinicaDona);
      expect(
        await expectDbError(db, `select public.hire_employee($1, 'braco-direito', 1, 'Novo')`, [
          ORGS.clinica,
        ]),
      ).toMatch(/permission denied/);
      expect(await expectDbError(db, `select * from public.queue_read('tarefas', 30, 1)`)).toMatch(
        /permission denied/,
      );
      expect(
        await expectDbError(db, `select public.connection_secret_get(gen_random_uuid())`),
      ).toMatch(/permission denied/);
      expect(await expectDbError(db, `update role_versions set version = 99`)).toMatch(
        /permission denied/,
      );
    });
  });
});
