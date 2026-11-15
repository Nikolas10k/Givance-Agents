/**
 * Canal WhatsApp de ponta a ponta contra o Supabase local (banco + Storage), com um WhatsApp
 * falso que registra o que seria enviado. Cobre verificação do número, comando -> tarefa,
 * foto, deduplicação, prévia com botões, aprovar, editar, janela de 24h e horário de silêncio.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createSupabaseToolServices, purgeOrganization, type QueueMessage } from '@givance/db';
import { createServiceClient } from '@givance/db/service';
import { approvalButtonId } from '@givance/integrations';
import { createDefaultRegistry } from '@givance/tools';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DeferError } from '../src/consumer';
import type { WhatsAppDeps, WorkerDeps } from '../src/deps';
import { createWhatsAppInboundHandler } from '../src/handlers/whatsapp-inbound';
import { createWhatsAppOutboundHandler } from '../src/handlers/whatsapp-outbound';
import { silentLogger } from '../src/logger';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const DB_URL =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const DONA = '10000000-0000-4000-8000-000000000002';
const NUMERO = `+55119${String(Date.now()).slice(-8)}`;

function localSecretKey(): string {
  if (process.env.SUPABASE_SECRET_KEY) return process.env.SUPABASE_SECRET_KEY;
  const status = execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return (JSON.parse(status) as { SECRET_KEY: string }).SECRET_KEY;
}

type Envio = { tipo: string; para: string; dados: Record<string, unknown> };

function whatsappFalso() {
  const envios: Envio[] = [];
  let seq = 0;
  const ok = async () => ({ messageId: `wamid.out.${++seq}` });
  const client: WhatsAppDeps['client'] = {
    async sendText(para, texto, opts) {
      envios.push({ tipo: 'texto', para, dados: { texto, ...opts } });
      return ok();
    },
    async sendButtons(para, input) {
      envios.push({ tipo: 'botoes', para, dados: input as unknown as Record<string, unknown> });
      return ok();
    },
    async sendTemplate(para, input) {
      envios.push({ tipo: 'template', para, dados: input as unknown as Record<string, unknown> });
      return ok();
    },
    async markRead() {},
    async downloadMedia() {
      return { data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), mimeType: 'image/jpeg', size: 4 };
    },
  };
  return {
    envios,
    wa: {
      client,
      templates: { aviso: 'givance_aviso', confirmacao: 'givance_confirmacao', idioma: 'pt_BR' },
    },
  };
}

let pgc: pg.Client;
let orgId: string;
let slug: string;
const falso = whatsappFalso();
let deps: WorkerDeps;
let agora = new Date();

function evento(mensagem: Record<string, unknown>): QueueMessage {
  return {
    msgId: 0,
    readCount: 1,
    enqueuedAt: new Date().toISOString(),
    message: {
      type: 'webhook',
      payload: {
        object: 'whatsapp_business_account',
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  messages: [
                    {
                      id: `wamid.in.${randomUUID()}`,
                      from: NUMERO.slice(1),
                      timestamp: String(Math.floor(agora.getTime() / 1000)),
                      ...mensagem,
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    },
  };
}

const texto = (body: string) => evento({ type: 'text', text: { body } });
const botao = (id: string) =>
  evento({
    type: 'interactive',
    interactive: { type: 'button_reply', button_reply: { id, title: 'x' } },
  });
const saida = (message: Record<string, unknown>): QueueMessage => ({
  msgId: 0,
  readCount: 1,
  enqueuedAt: new Date().toISOString(),
  message: { org_id: orgId, ...message },
});

beforeAll(async () => {
  pgc = new pg.Client({ connectionString: DB_URL });
  await pgc.connect();
  slug = `teste-zap-${randomUUID().slice(0, 8)}`;
  const org = await pgc.query<{ id: string }>(
    `insert into organizations (name, slug) values ('Empresa do Teste de WhatsApp', $1) returning id`,
    [slug],
  );
  orgId = org.rows[0]!.id;
  await pgc.query(`insert into memberships (org_id, user_id, role) values ($1, $2, 'owner')`, [
    orgId,
    DONA,
  ]);
  await pgc.query(`select public.hire_employee($1, 'braco-direito', 1, 'Lia')`, [orgId]);
  const db = createServiceClient({
    url: process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321',
    secretKey: localSecretKey(),
  });
  deps = {
    db,
    services: createSupabaseToolServices(db),
    registry: createDefaultRegistry(),
    contentRoot: ROOT,
    logger: silentLogger,
    jobs: {},
    whatsapp: falso.wa,
    now: () => agora,
  };
});

afterAll(async () => {
  for (const fila of ['tarefas', 'acoes', 'rotinas', 'whatsapp_saida']) {
    await pgc.query(`delete from pgmq.q_${fila} where message ->> 'org_id' = $1`, [orgId]);
  }
  await purgeOrganization(deps.db, orgId, slug);
  await pgc.end();
});

const entrada = () => createWhatsAppInboundHandler(deps);
const enviar = () => createWhatsAppOutboundHandler(deps);
const ultimo = () => falso.envios.at(-1)!;

async function criarAprovacao(taskId: string, nivel = 'confirmar') {
  const { rows } = await pgc.query<{ id: string }>(
    `insert into approvals (org_id, task_id, action_type, payload, preview, reason, autonomy_level, requested_by_agent, idempotency_key)
     values ($1, $2, 'memoria.registrar', '{"titulo":"Preço","conteudo":"Não divulgar preço do clareamento."}',
       '{"titulo":"Registrar na memória da empresa","resumo":"Não divulgar preço do clareamento."}', 'Pedido do dono', $3, 'orquestrador', $4)
     returning id`,
    [orgId, taskId, nivel, `acao:${randomUUID()}`],
  );
  return rows[0]!.id;
}

describe('canal WhatsApp do dono', () => {
  let taskId: string;

  it('número desconhecido recebe a orientação de como ligar', async () => {
    await entrada()(texto('oi'));
    expect(ultimo()).toMatchObject({ tipo: 'texto', para: NUMERO });
    expect(String(ultimo().dados.texto)).toMatch(/Peça o código de verificação no painel/);
  });

  it('código do painel enviado pelo WhatsApp verifica o número', async () => {
    await pgc.query('begin');
    await pgc.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: DONA, role: 'authenticated' }),
    ]);
    await pgc.query('set local role authenticated');
    const { rows } = await pgc.query<{ c: string }>(
      'select public.start_channel_verification($1, $2) as c',
      [orgId, NUMERO],
    );
    await pgc.query('commit');

    await entrada()(texto('000000'));
    expect(String(ultimo().dados.texto)).toMatch(/não está ligado/);
    await entrada()(texto(`GIVANCE ${rows[0]!.c}`));
    expect(String(ultimo().dados.texto)).toMatch(/Pronto! .*Empresa do Teste de WhatsApp/);
    const canal = await pgc.query(
      'select verified_at is not null as ok from channels where org_id = $1',
      [orgId],
    );
    expect(canal.rows[0]).toEqual({ ok: true });
  });

  it('texto vira tarefa do funcionário, uma vez só, com conversa no WhatsApp', async () => {
    const msg = texto('Posta amanhã às 18h falando da promoção de limpeza');
    await entrada()(msg);
    await entrada()(msg);
    const tarefas = await pgc.query<{
      id: string;
      title: string;
      source: string;
      input: Record<string, unknown>;
    }>(`select id, title, source, input from tasks where org_id = $1`, [orgId]);
    expect(tarefas.rows).toHaveLength(1);
    expect(tarefas.rows[0]).toMatchObject({
      source: 'whatsapp',
      title: 'Posta amanhã às 18h falando da promoção de limpeza',
    });
    taskId = tarefas.rows[0]!.id;
    const conversa = await pgc.query(
      `select c.channel, c.channel_id is not null as tem_canal from tasks t join conversations c on c.id = t.conversation_id where t.id = $1`,
      [taskId],
    );
    expect(conversa.rows[0]).toEqual({ channel: 'whatsapp', tem_canal: true });
  });

  it('foto com legenda é guardada no Storage e vai junto da tarefa', async () => {
    await entrada()(
      evento({
        type: 'image',
        image: { id: 'media-1', mime_type: 'image/jpeg', caption: 'Usa esta foto no post' },
      }),
    );
    const { rows } = await pgc.query<{ input: { midias?: string[]; mensagem: string } }>(
      `select input from tasks where org_id = $1 and title = 'Usa esta foto no post'`,
      [orgId],
    );
    expect(rows[0]!.input.midias).toHaveLength(1);
    const midia = await pgc.query<{ storage_path: string }>(
      `select storage_path from media_assets where id = $1`,
      [rows[0]!.input.midias![0]],
    );
    const objeto = await pgc.query(
      `select count(*)::int as n from storage.objects where bucket_id = 'midia' and name = $1`,
      [midia.rows[0]!.storage_path],
    );
    expect(objeto.rows[0].n).toBe(1);
  });

  it('aprovação pendente vira prévia com botões; Aprovar decide e coloca a ação na fila', async () => {
    const approvalId = await criarAprovacao(taskId);
    await enviar()(saida({ type: 'approval.notify', approval_id: approvalId }));
    expect(ultimo().tipo).toBe('botoes');
    const botoes = (ultimo().dados.buttons as Array<{ id: string }>).map((b) => b.id);
    expect(botoes).toEqual([
      approvalButtonId(approvalId, 'aprovar'),
      approvalButtonId(approvalId, 'editar'),
      approvalButtonId(approvalId, 'recusar'),
    ]);
    expect(String(ultimo().dados.body)).toMatch(/Registrar na memória da empresa/);

    // Repetir o aviso não manda a prévia de novo.
    const antes = falso.envios.length;
    await enviar()(saida({ type: 'approval.notify', approval_id: approvalId }));
    expect(falso.envios.length).toBe(antes);

    await entrada()(botao(approvalButtonId(approvalId, 'aprovar')));
    const ap = await pgc.query('select status, decision_channel from approvals where id = $1', [
      approvalId,
    ]);
    expect(ap.rows[0]).toEqual({ status: 'aprovada', decision_channel: 'whatsapp' });
    const fila = await pgc.query(
      `select count(*)::int as n from pgmq.q_acoes where message ->> 'approval_id' = $1`,
      [approvalId],
    );
    expect(fila.rows[0].n).toBe(1);

    await entrada()(botao(approvalButtonId(approvalId, 'recusar')));
    expect(String(ultimo().dados.texto)).toMatch(/já foi decidida/);
  });

  it('Editar: a próxima mensagem do dono vira o pedido de ajuste e a tarefa volta para o funcionário', async () => {
    await pgc.query(`update tasks set status = 'aguardando_aprovacao' where id = $1`, [taskId]);
    const approvalId = await criarAprovacao(taskId);
    await entrada()(botao(approvalButtonId(approvalId, 'editar')));
    expect(String(ultimo().dados.texto)).toMatch(/O que você quer mudar/);
    await entrada()(texto('Troca a primeira frase por algo mais acolhedor'));
    const ap = await pgc.query('select status, decision_note from approvals where id = $1', [
      approvalId,
    ]);
    expect(ap.rows[0].status).toBe('recusada');
    expect(ap.rows[0].decision_note).toMatch(/Troca a primeira frase/);
    const tarefa = await pgc.query('select status from tasks where id = $1', [taskId]);
    expect(tarefa.rows[0]).toEqual({ status: 'a_fazer' });
    const novas = await pgc.query(
      `select count(*)::int as n from tasks where org_id = $1 and title like 'Troca a primeira%'`,
      [orgId],
    );
    expect(novas.rows[0].n).toBe(0);
  });

  it('ação de painel avisa pelo WhatsApp sem botões', async () => {
    const approvalId = await criarAprovacao(taskId, 'sempre_aprovar');
    await enviar()(saida({ type: 'approval.notify', approval_id: approvalId }));
    expect(ultimo()).toMatchObject({ tipo: 'texto' });
    expect(String(ultimo().dados.texto)).toMatch(/aprovação no painel/);
  });

  it('mensagem do funcionário: texto livre na janela de 24h, template fora dela, adiada no silêncio', async () => {
    const aviso = await deps.services.messages.notifyOwner({
      orgId,
      employeeId: await funcionario(),
      taskId: null,
      content: 'E-mail importante do contador.',
    });
    expect(aviso).not.toBeNull();
    await enviar()(saida({ type: 'message.deliver', message_id: aviso!.messageId }));
    expect(ultimo()).toMatchObject({
      tipo: 'texto',
      dados: { texto: 'E-mail importante do contador.' },
    });
    const entregue = await pgc.query(
      'select delivery_status, external_id from messages where id = $1',
      [aviso!.messageId],
    );
    expect(entregue.rows[0].delivery_status).toBe('enviada');

    await pgc.query(
      `update channels set last_inbound_at = now() - interval '2 days' where org_id = $1`,
      [orgId],
    );
    const fora = await deps.services.messages.notifyOwner({
      orgId,
      employeeId: await funcionario(),
      taskId: null,
      content: 'Outro aviso\ncom quebra.',
    });
    await enviar()(saida({ type: 'message.deliver', message_id: fora!.messageId }));
    expect(ultimo()).toMatchObject({
      tipo: 'template',
      dados: { name: 'givance_aviso', bodyParams: ['Outro aviso com quebra.'] },
    });

    // Silêncio das 22h às 7h em São Paulo; 23:30 local.
    await pgc.query(
      `update channels set quiet_hours = '{"inicio":"22:00","fim":"07:00"}' where org_id = $1`,
      [orgId],
    );
    agora = new Date('2026-11-17T02:30:00Z');
    const noturno = await deps.services.messages.notifyOwner({
      orgId,
      employeeId: await funcionario(),
      taskId: null,
      content: 'Aviso noturno.',
    });
    await expect(
      enviar()(saida({ type: 'message.deliver', message_id: noturno!.messageId })),
    ).rejects.toBeInstanceOf(DeferError);
    agora = new Date();
  });
});

async function funcionario(): Promise<string> {
  const { rows } = await pgc.query<{ id: string }>('select id from employees where org_id = $1', [
    orgId,
  ]);
  return rows[0]!.id;
}
