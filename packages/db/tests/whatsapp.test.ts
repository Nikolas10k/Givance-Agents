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

async function contarSaida(campo: string, valor: string) {
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int as n from pgmq.q_whatsapp_saida where message ->> $1 = $2`,
    [campo, valor],
  );
  return rows[0]!.n;
}

describe('verificação do número do dono', () => {
  it('gera código, confirma pelo número certo e recusa código errado ou vencido', async () => {
    await inRollback(db, async () => {
      await actAs(db, USERS.padariaDono);
      const { rows } = await db.query<{ code: string }>(
        `select public.start_channel_verification($1, '(11) 98888-7777') as code`,
        [ORGS.padaria],
      );
      const codigo = rows[0]!.code;
      expect(codigo).toMatch(/^\d{6}$/);

      await actAsOwner(db);
      const salvo = await db.query(
        `select address_e164, verified_at, verification_code_hash from channels where org_id = $1`,
        [ORGS.padaria],
      );
      expect(salvo.rows[0]).toMatchObject({ address_e164: '+5511988887777', verified_at: null });
      expect(salvo.rows[0].verification_code_hash).not.toBe(codigo);

      await actAsService(db);
      const errado = await db.query(
        `select * from public.confirm_channel_verification('+5511988887777', '000000')`,
      );
      const outroNumero = await db.query(
        `select * from public.confirm_channel_verification('+5511900000000', $1)`,
        [codigo],
      );
      expect([errado.rowCount, outroNumero.rowCount]).toEqual([0, 0]);
      const certo = await db.query<{ org_id: string; user_id: string }>(
        `select * from public.confirm_channel_verification('+5511988887777', $1)`,
        [codigo],
      );
      expect(certo.rows[0]).toMatchObject({ org_id: ORGS.padaria, user_id: USERS.padariaDono });
      const repetido = await db.query(
        `select * from public.confirm_channel_verification('+5511988887777', $1)`,
        [codigo],
      );
      expect(repetido.rowCount).toBe(0);
    });
  });

  it('não gera código para empresa de que o usuário não é membro; número inválido é recusado', async () => {
    await inRollback(db, async () => {
      await actAs(db, USERS.padariaDono);
      expect(
        await expectDbError(db, `select public.start_channel_verification($1, '11988887777')`, [
          ORGS.clinica,
        ]),
      ).toMatch(/não encontrada/);
      expect(
        await expectDbError(db, `select public.start_channel_verification($1, '123')`, [
          ORGS.padaria,
        ]),
      ).toMatch(/Número inválido/);
      expect(
        await expectDbError(
          db,
          `select * from public.confirm_channel_verification('+5511988887777', '123456')`,
        ),
      ).toMatch(/permission denied/);
    });
  });
});

describe('decisão pelo WhatsApp', () => {
  it('dono decide pelo worker; membro não; ação de painel não é aprovada pelo WhatsApp', async () => {
    await inRollback(db, async () => {
      const { taskId } = await createFixtureTask(db, ORGS.clinica, 'aguardando_aprovacao');
      const confirmar = await createFixtureApproval(db, ORGS.clinica, taskId);
      const painel = await createFixtureApproval(db, ORGS.clinica, taskId, {
        level: 'sempre_aprovar',
      });

      await actAsService(db);
      expect(
        await expectDbError(db, `select public.decide_approval_as($1, $2, 'aprovar')`, [
          USERS.clinicaRecepcao,
          confirmar,
        ]),
      ).toMatch(/não encontrada/);
      expect(
        await expectDbError(db, `select public.decide_approval_as($1, $2, 'aprovar')`, [
          USERS.clinicaDona,
          painel,
        ]),
      ).toMatch(/só pode ser aprovada no painel/);
      const ok = await db.query<{ s: string }>(
        `select public.decide_approval_as($1, $2, 'aprovar') as s`,
        [USERS.clinicaDona, confirmar],
      );
      expect(ok.rows[0]!.s).toBe('aprovada');

      await actAsOwner(db);
      const registro = await db.query(
        'select decision_channel, decided_by from approvals where id = $1',
        [confirmar],
      );
      expect(registro.rows[0]).toEqual({
        decision_channel: 'whatsapp',
        decided_by: USERS.clinicaDona,
      });

      await actAs(db, USERS.clinicaDona);
      expect(
        await expectDbError(db, `select public.decide_approval_as($1, $2, 'aprovar')`, [
          USERS.clinicaDona,
          painel,
        ]),
      ).toMatch(/permission denied/);
    });
  });

  it('o painel continua decidindo pela sessão do usuário', async () => {
    await inRollback(db, async () => {
      const { taskId } = await createFixtureTask(db, ORGS.clinica, 'aguardando_aprovacao');
      const aprovacao = await createFixtureApproval(db, ORGS.clinica, taskId, {
        level: 'sempre_aprovar',
      });
      await actAs(db, USERS.clinicaDona);
      const r = await db.query<{ s: string }>(`select public.decide_approval($1, 'aprovar') as s`, [
        aprovacao,
      ]);
      expect(r.rows[0]!.s).toBe('aprovada');
    });
  });
});

describe('filas de saída e entrada', () => {
  it('aprovação pendente e mensagem pendente entram na fila de saída; mensagem de painel não', async () => {
    await inRollback(db, async () => {
      const { taskId, employeeId } = await createFixtureTask(db, ORGS.clinica);
      const aprovacao = await createFixtureApproval(db, ORGS.clinica, taskId);
      expect(await contarSaida('approval_id', aprovacao)).toBe(1);

      const conversa = await db.query<{ id: string }>(
        `insert into conversations (org_id, employee_id, channel) values ($1, $2, 'whatsapp') returning id`,
        [ORGS.clinica, employeeId],
      );
      const zap = await db.query<{ id: string }>(
        `insert into messages (org_id, conversation_id, author, content, delivery_status) values ($1, $2, 'funcionario', 'Oi', 'pendente') returning id`,
        [ORGS.clinica, conversa.rows[0]!.id],
      );
      const painel = await db.query<{ id: string }>(
        `insert into messages (org_id, conversation_id, author, content) values ($1, $2, 'funcionario', 'Oi') returning id`,
        [ORGS.clinica, conversa.rows[0]!.id],
      );
      expect(await contarSaida('message_id', zap.rows[0]!.id)).toBe(1);
      expect(await contarSaida('message_id', painel.rows[0]!.id)).toBe(0);
    });
  });

  it('cada mensagem recebida é processada uma vez só', async () => {
    await inRollback(db, async () => {
      await actAsService(db);
      const a = await db.query<{ ok: boolean }>(
        `select public.whatsapp_inbound_claim('wamid.TESTE1') as ok`,
      );
      const b = await db.query<{ ok: boolean }>(
        `select public.whatsapp_inbound_claim('wamid.TESTE1') as ok`,
      );
      expect([a.rows[0]!.ok, b.rows[0]!.ok]).toEqual([true, false]);
      await db.query(`select public.queue_send('whatsapp_entrada', '{"type":"teste"}')`);
    });
  });
});
