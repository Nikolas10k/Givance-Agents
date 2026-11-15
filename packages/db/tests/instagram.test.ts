import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  actAs,
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

async function criarPost(orgId: string) {
  const { taskId } = await createFixtureTask(db, orgId, 'aguardando_aprovacao');
  const approvalId = await createFixtureApproval(db, orgId, taskId);
  const midia = await db.query<{ id: string }>(
    `insert into media_assets (org_id, storage_path, mime_type, source, width, height)
     values ($1, $2, 'image/jpeg', 'whatsapp', 1080, 1350) returning id`,
    [orgId, `${orgId}/${crypto.randomUUID()}.jpg`],
  );
  const post = await db.query<{ id: string }>(
    `insert into social_posts (org_id, task_id, approval_id, format, caption, media_ids)
     values ($1, $2, $3, 'feed', 'Legenda', array[$4::uuid]) returning id`,
    [orgId, taskId, approvalId, midia.rows[0]!.id],
  );
  return { taskId, approvalId, postId: post.rows[0]!.id };
}

describe('posts do Instagram', () => {
  it('recusar a aprovação cancela o post; post publicado não muda', async () => {
    await inRollback(db, async () => {
      const recusado = await criarPost(ORGS.clinica);
      const publicado = await criarPost(ORGS.clinica);
      await db.query(
        `update social_posts set status = 'publicado', ig_media_id = '1789', published_at = now() where id = $1`,
        [publicado.postId],
      );

      await actAs(db, USERS.clinicaDona);
      await db.query(`select public.decide_approval($1, 'recusar')`, [recusado.approvalId]);
      await actAsOwner(db);
      await db.query(
        `update approvals set status = 'cancelada', decided_at = now(), decision_channel = 'sistema' where id = $1`,
        [publicado.approvalId],
      );

      const { rows } = await db.query<{ id: string; status: string }>(
        `select id, status from social_posts where id = any($1)`,
        [[recusado.postId, publicado.postId]],
      );
      const porId = Object.fromEntries(rows.map((r) => [r.id, r.status]));
      expect(porId[recusado.postId]).toBe('cancelado');
      expect(porId[publicado.postId]).toBe('publicado');
    });
  });

  it('membro só lê; não cria nem altera posts', async () => {
    await inRollback(db, async () => {
      const { postId, taskId } = await criarPost(ORGS.clinica);
      const approvalId = await createFixtureApproval(db, ORGS.clinica, taskId);
      await actAs(db, USERS.clinicaRecepcao);
      const lidos = await db.query(`select id from social_posts where id = $1`, [postId]);
      expect(lidos.rowCount).toBe(1);
      expect(
        await expectDbError(db, `update social_posts set caption = 'Outra' where id = $1`, [
          postId,
        ]),
      ).toMatch(/permission denied/);
      expect(
        await expectDbError(
          db,
          `insert into social_posts (org_id, task_id, approval_id, format, media_ids)
           values ($1, $2, $3, 'feed', array[gen_random_uuid()])`,
          [ORGS.clinica, taskId, approvalId],
        ),
      ).toMatch(/permission denied|row-level security/);
    });
  });

  it('não liga post a tarefa ou aprovação de outra empresa', async () => {
    await inRollback(db, async () => {
      const { taskId } = await criarPost(ORGS.clinica);
      const approvalId = await createFixtureApproval(db, ORGS.clinica, taskId);
      expect(
        await expectDbError(
          db,
          `insert into social_posts (org_id, task_id, approval_id, format, media_ids)
           values ($1, $2, $3, 'feed', array[gen_random_uuid()])`,
          [ORGS.padaria, taskId, approvalId],
        ),
      ).toMatch(/foreign key/);
    });
  });

  it('publicado exige id da mídia e data; limites de legenda e de mídias', async () => {
    await inRollback(db, async () => {
      const { postId, taskId } = await criarPost(ORGS.padaria);
      expect(
        await expectDbError(db, `update social_posts set status = 'publicado' where id = $1`, [
          postId,
        ]),
      ).toMatch(/check constraint/);
      expect(
        await expectDbError(
          db,
          `update social_posts set caption = repeat('a', 2201) where id = $1`,
          [postId],
        ),
      ).toMatch(/check constraint/);
      const outra = await createFixtureApproval(db, ORGS.padaria, taskId);
      expect(
        await expectDbError(
          db,
          `insert into social_posts (org_id, task_id, approval_id, format, media_ids)
           values ($1, $2, $3, 'carrossel', array_fill(gen_random_uuid(), array[11]))`,
          [ORGS.padaria, taskId, outra],
        ),
      ).toMatch(/check constraint/);
    });
  });
});
