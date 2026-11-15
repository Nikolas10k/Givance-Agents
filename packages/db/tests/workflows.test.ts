import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  actAs,
  actAsOwner,
  actAsService,
  connect,
  createFixtureApproval,
  createFixtureTask,
  expectDbError,
  inRollback,
  ORGS,
  queueCount,
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

describe('criação de tarefa pelo painel', () => {
  it('cria, enfileira para o worker, atualiza o status do funcionário e audita', async () => {
    await inRollback(db, async () => {
      const { rows } = await db.query<{ id: string }>(
        'select id from employees where org_id = $1',
        [ORGS.clinica],
      );
      const employeeId = rows[0]!.id;

      await actAs(db, USERS.clinicaRecepcao);
      const criada = await db.query<{ id: string }>(
        `select public.create_task($1, 'Post da promoção de limpeza', '{"mensagem": "posta amanhã às 18h"}') as id`,
        [employeeId],
      );
      const taskId = criada.rows[0]!.id;

      await actAsOwner(db);
      expect(await queueCount(db, 'tarefas', 'task_id', taskId)).toBe(1);
      const tarefa = await db.query('select status, source, created_by from tasks where id = $1', [
        taskId,
      ]);
      expect(tarefa.rows[0]).toEqual({
        status: 'a_fazer',
        source: 'painel',
        created_by: USERS.clinicaRecepcao,
      });
      const funcionario = await db.query('select status from employees where id = $1', [
        employeeId,
      ]);
      expect(funcionario.rows[0]).toEqual({ status: 'trabalhando' });
      const auditoria = await db.query(`select action from audit_log where task_id = $1`, [taskId]);
      expect(auditoria.rows).toEqual([{ action: 'tarefa.criada' }]);
    });
  });

  it('não cria tarefa para funcionário de outra empresa', async () => {
    await inRollback(db, async () => {
      const { rows } = await db.query<{ id: string }>(
        'select id from employees where org_id = $1',
        [ORGS.clinica],
      );
      await actAs(db, USERS.padariaDono);
      const erro = await expectDbError(db, `select public.create_task($1, 'Intrusa')`, [
        rows[0]!.id,
      ]);
      expect(erro).toMatch(/Funcionário não encontrado/);
    });
  });
});

describe('decisão de aprovações', () => {
  it('membro e dono de outra empresa não decidem; dono aprova e a ação entra na fila', async () => {
    await inRollback(db, async () => {
      const { taskId } = await createFixtureTask(db, ORGS.clinica, 'aguardando_aprovacao');
      const approvalId = await createFixtureApproval(db, ORGS.clinica, taskId);

      for (const usuario of [USERS.clinicaRecepcao, USERS.padariaDono]) {
        await actAs(db, usuario);
        expect(
          await expectDbError(db, `select public.decide_approval($1, 'aprovar')`, [approvalId]),
        ).toMatch(/não encontrada/);
      }

      await actAs(db, USERS.clinicaDona);
      const decisao = await db.query<{ status: string }>(
        `select public.decide_approval($1, 'aprovar', null, 'Pode registrar') as status`,
        [approvalId],
      );
      expect(decisao.rows[0]!.status).toBe('aprovada');
      expect(
        await expectDbError(db, `select public.decide_approval($1, 'recusar')`, [approvalId]),
      ).toMatch(/já foi decidida/);

      await actAsOwner(db);
      expect(await queueCount(db, 'acoes', 'approval_id', approvalId)).toBe(1);
      const registro = await db.query(
        'select decided_by, decision_channel from approvals where id = $1',
        [approvalId],
      );
      expect(registro.rows[0]).toEqual({
        decided_by: USERS.clinicaDona,
        decision_channel: 'painel',
      });
    });
  });

  it('recusa devolve a tarefa ao orquestrador; edição guarda o payload editado', async () => {
    await inRollback(db, async () => {
      const { taskId } = await createFixtureTask(db, ORGS.clinica, 'aguardando_aprovacao');
      const recusar = await createFixtureApproval(db, ORGS.clinica, taskId);
      const editar = await createFixtureApproval(db, ORGS.clinica, taskId);

      await actAs(db, USERS.clinicaDona);
      await db.query(`select public.decide_approval($1, 'recusar', null, 'Texto muito longo')`, [
        recusar,
      ]);
      const editada = await db.query<{ status: string }>(
        `select public.decide_approval($1, 'aprovar', '{"titulo":"Ajustado","conteudo":"Conteúdo ajustado pelo dono"}') as status`,
        [editar],
      );
      expect(editada.rows[0]!.status).toBe('editada');

      await actAsOwner(db);
      const tarefa = await db.query('select status from tasks where id = $1', [taskId]);
      expect(tarefa.rows[0]).toEqual({ status: 'a_fazer' });
      expect(await queueCount(db, 'tarefas', 'task_id', taskId)).toBe(1);
      expect(await queueCount(db, 'acoes', 'approval_id', recusar)).toBe(0);
      const payload = await db.query(
        'select edited_payload ->> $2 as titulo from approvals where id = $1',
        [editar, 'titulo'],
      );
      expect(payload.rows[0]).toEqual({ titulo: 'Ajustado' });
    });
  });

  it('aprovação no painel não pode ser dada pelo WhatsApp; aprovação vencida não é aceita', async () => {
    await inRollback(db, async () => {
      const { taskId } = await createFixtureTask(db, ORGS.clinica, 'aguardando_aprovacao');
      const painel = await createFixtureApproval(db, ORGS.clinica, taskId, {
        level: 'sempre_aprovar',
      });
      const vencida = await createFixtureApproval(db, ORGS.clinica, taskId, {
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      });

      await actAs(db, USERS.clinicaDona);
      expect(
        await expectDbError(
          db,
          `select public.decide_approval($1, 'aprovar', null, null, 'whatsapp')`,
          [painel],
        ),
      ).toMatch(/só pode ser aprovada no painel/);
      expect(
        await expectDbError(db, `select public.decide_approval($1, 'aprovar')`, [vencida]),
      ).toMatch(/expirou/);
    });
  });

  it('o job de expiração encerra pendências vencidas e devolve a tarefa', async () => {
    await inRollback(db, async () => {
      const { taskId } = await createFixtureTask(db, ORGS.clinica, 'aguardando_aprovacao');
      const vencida = await createFixtureApproval(db, ORGS.clinica, taskId, {
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      });
      const total = await db.query<{ n: number }>('select private.expire_approvals() as n');
      expect(total.rows[0]!.n).toBeGreaterThanOrEqual(1);
      const aprovacao = await db.query('select status from approvals where id = $1', [vencida]);
      expect(aprovacao.rows[0]).toEqual({ status: 'expirada' });
      const tarefa = await db.query('select status from tasks where id = $1', [taskId]);
      expect(tarefa.rows[0]).toEqual({ status: 'a_fazer' });
    });
  });

  it('aprovação automática (inserida já aprovada) também entra na fila', async () => {
    await inRollback(db, async () => {
      const { taskId } = await createFixtureTask(db, ORGS.clinica);
      const { rows } = await db.query<{ id: string }>(
        `insert into approvals (org_id, task_id, action_type, payload, autonomy_level, status, decided_at, decision_channel, requested_by_agent, idempotency_key)
         values ($1, $2, 'memoria.registrar', '{}', 'automatico', 'aprovada', now(), 'sistema', 'orquestrador', 'acao:automatica-0001')
         returning id`,
        [ORGS.clinica, taskId],
      );
      expect(await queueCount(db, 'acoes', 'approval_id', rows[0]!.id)).toBe(1);
    });
  });
});

describe('execuções de ações', () => {
  it('no máximo uma tentativa em andamento e uma com sucesso por aprovação', async () => {
    await inRollback(db, async () => {
      const { taskId } = await createFixtureTask(db, ORGS.clinica);
      const approvalId = await createFixtureApproval(db, ORGS.clinica, taskId);
      await db.query(
        `insert into action_executions (org_id, approval_id, attempt) values ($1, $2, 1)`,
        [ORGS.clinica, approvalId],
      );
      expect(
        await expectDbError(
          db,
          `insert into action_executions (org_id, approval_id, attempt) values ($1, $2, 2)`,
          [ORGS.clinica, approvalId],
        ),
      ).toMatch(/action_executions_one_running_idx/);
      await db.query(`update action_executions set status = 'sucesso' where approval_id = $1`, [
        approvalId,
      ]);
      await db.query(
        `insert into action_executions (org_id, approval_id, attempt, status) values ($1, $2, 2, 'falhou')`,
        [ORGS.clinica, approvalId],
      );
      expect(
        await expectDbError(
          db,
          `insert into action_executions (org_id, approval_id, attempt, status) values ($1, $2, 3, 'sucesso')`,
          [ORGS.clinica, approvalId],
        ),
      ).toMatch(/action_executions_one_success_idx/);
    });
  });
});

describe('auditoria', () => {
  it('ninguém altera nem apaga registros, nem com a chave secreta', async () => {
    await inRollback(db, async () => {
      await actAsService(db);
      expect(await expectDbError(db, `update audit_log set reason = 'x'`)).toMatch(
        /permission denied/,
      );
      expect(await expectDbError(db, `delete from audit_log`)).toMatch(/permission denied/);
      await actAsOwner(db);
      expect(await expectDbError(db, `delete from audit_log`)).toMatch(/não pode ser alterado/);
      expect(await expectDbError(db, `truncate audit_log`)).toMatch(/não pode ser alterado/);
    });
  });

  it('a exclusão de empresa (LGPD) apaga tudo dela, inclusive auditoria e segredos', async () => {
    await inRollback(db, async () => {
      await actAsOwner(db);
      const conexao = await db.query<{ id: string }>(
        `insert into connections (org_id, provider) values ($1, 'instagram') returning id`,
        [ORGS.padaria],
      );
      await actAsService(db);
      await db.query('select public.connection_secret_set($1, $2)', [
        conexao.rows[0]!.id,
        'token-de-teste',
      ]);

      expect(
        await expectDbError(db, `select public.admin_purge_organization($1, 'slug-errado')`, [
          ORGS.padaria,
        ]),
      ).toMatch(/não confere/);
      await db.query(`select public.admin_purge_organization($1, 'padaria-modelo')`, [
        ORGS.padaria,
      ]);

      await actAsOwner(db);
      for (const tabela of ['organizations', 'employees', 'audit_log', 'products', 'connections']) {
        const coluna = tabela === 'organizations' ? 'id' : 'org_id';
        const { rows } = await db.query(
          `select count(*)::int as n from public.${tabela} where ${coluna} = $1`,
          [ORGS.padaria],
        );
        expect({ tabela, n: rows[0].n }).toEqual({ tabela, n: 0 });
      }
      const segredos = await db.query(
        `select count(*)::int as n from vault.secrets where name = $1`,
        [`connection:${conexao.rows[0]!.id}`],
      );
      expect(segredos.rows[0].n).toBe(0);
      const outras = await db.query(`select count(*)::int as n from audit_log where org_id = $1`, [
        ORGS.clinica,
      ]);
      expect(outras.rows[0].n).toBeGreaterThan(0);
    });
  });
});

describe('segredos de conexões (Vault)', () => {
  it('grava, substitui e lê o token só com a chave secreta', async () => {
    await inRollback(db, async () => {
      await actAsOwner(db);
      const { rows } = await db.query<{ id: string }>(
        `insert into connections (org_id, provider) values ($1, 'google') returning id`,
        [ORGS.clinica],
      );
      const id = rows[0]!.id;
      await actAsService(db);
      await db.query('select public.connection_secret_set($1, $2)', [id, 'primeiro']);
      await db.query('select public.connection_secret_set($1, $2)', [id, 'segundo']);
      const lido = await db.query<{ s: string }>('select public.connection_secret_get($1) as s', [
        id,
      ]);
      expect(lido.rows[0]!.s).toBe('segundo');

      await actAs(db, USERS.clinicaDona);
      const conexoes = await db.query('select * from connections where id = $1', [id]);
      expect(Object.keys(conexoes.rows[0])).not.toContain('vault_secret_id');
    });
  });
});

describe('rotinas', () => {
  it('rotina vencida entra na fila uma vez; funcionário pausado não dispara', async () => {
    await inRollback(db, async () => {
      await actAsOwner(db);
      await db.query(
        `update routines set next_run_at = now() - interval '1 minute' where routine_key = 'resumo-diario'`,
      );
      await db.query(`update employees set status = 'pausado' where org_id = $1`, [ORGS.givance]);
      const n = await db.query<{ n: number }>('select private.enqueue_due_routines() as n');
      expect(n.rows[0]!.n).toBe(1);

      const clinica = await db.query<{
        id: string;
        in_flight: boolean;
        next_run_at: string | null;
      }>(
        `select id, in_flight, next_run_at from routines where org_id = $1 and routine_key = 'resumo-diario'`,
        [ORGS.clinica],
      );
      expect(clinica.rows[0]).toMatchObject({ in_flight: true, next_run_at: null });
      expect(await queueCount(db, 'rotinas', 'routine_id', clinica.rows[0]!.id)).toBe(1);

      const repetido = await db.query<{ n: number }>('select private.enqueue_due_routines() as n');
      expect(repetido.rows[0]!.n).toBe(0);
    });
  });

  it('mudar o cron obriga a recalcular o próximo horário', async () => {
    await inRollback(db, async () => {
      await actAsOwner(db);
      await db.query(
        `update routines set next_run_at = now() + interval '1 day' where org_id = $1`,
        [ORGS.clinica],
      );
      await actAs(db, USERS.clinicaDona);
      await db.query(
        `update routines set cron = '30 7 * * *' where org_id = $1 and routine_key = 'resumo-diario'`,
        [ORGS.clinica],
      );
      const { rows } = await db.query(
        `select next_run_at from routines where org_id = $1 and routine_key = 'resumo-diario'`,
        [ORGS.clinica],
      );
      expect(rows[0]).toEqual({ next_run_at: null });
    });
  });
});

describe('consumo', () => {
  it('soma o consumo de uma execução uma única vez', async () => {
    await inRollback(db, async () => {
      const { taskId, employeeId } = await createFixtureTask(db, ORGS.clinica);
      const { rows } = await db.query<{ id: string }>(
        `insert into agent_runs (org_id, task_id, run_number, trigger, input_tokens, output_tokens, cost_usd)
         values ($1, $2, 1, 'inicio', 1000, 200, 0.0123) returning id`,
        [ORGS.clinica, taskId],
      );
      await actAsService(db);
      const primeira = await db.query<{ ok: boolean }>('select public.record_run_usage($1) as ok', [
        rows[0]!.id,
      ]);
      const segunda = await db.query<{ ok: boolean }>('select public.record_run_usage($1) as ok', [
        rows[0]!.id,
      ]);
      expect([primeira.rows[0]!.ok, segunda.rows[0]!.ok]).toEqual([true, false]);

      const ledger = await db.query(
        `select input_tokens::int, output_tokens::int, cost_usd::float, runs from usage_ledger where employee_id = $1`,
        [employeeId],
      );
      expect(ledger.rows).toEqual([
        { input_tokens: 1000, output_tokens: 200, cost_usd: 0.0123, runs: 1 },
      ]);
    });
  });
});

describe('cargos', () => {
  it('versões publicadas são imutáveis', async () => {
    await inRollback(db, async () => {
      await actAsOwner(db);
      expect(await expectDbError(db, `update role_versions set config = '{}'`)).toMatch(
        /imutáveis/,
      );
    });
  });
});
