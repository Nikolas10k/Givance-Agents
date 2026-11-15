/**
 * Instagram de ponta a ponta contra o Supabase local (banco + Storage): pedido com foto ->
 * especialista prepara o post -> prévia com a foto no WhatsApp -> dono aprova -> recorte em
 * JPEG -> publicação (API do Instagram simulada) -> link para o dono. Cobre também o post
 * agendado, a retomada sem post duplicado e o token revogado.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { HookInput, Options, SDKMessage, query } from '@anthropic-ai/claude-agent-sdk';
import { createSupabaseToolServices, purgeOrganization, type QueueMessage } from '@givance/db';
import { createServiceClient } from '@givance/db/service';
import { InstagramError } from '@givance/integrations';
import { createDefaultRegistry } from '@givance/tools';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import pg from 'pg';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DeferError } from '../src/consumer';
import type { WhatsAppDeps, WorkerDeps } from '../src/deps';
import { createActionExecuteHandler } from '../src/handlers/action-execute';
import { createTaskRunHandler } from '../src/handlers/task-run';
import { createWhatsAppOutboundHandler } from '../src/handlers/whatsapp-outbound';
import { createInstagramService, type InstagramApi } from '../src/instagram/service';
import { silentLogger } from '../src/logger';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const DB_URL =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const DONA = '10000000-0000-4000-8000-000000000002';

function localSecretKey(): string {
  if (process.env.SUPABASE_SECRET_KEY) return process.env.SUPABASE_SECRET_KEY;
  const status = execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return (JSON.parse(status) as { SECRET_KEY: string }).SECRET_KEY;
}

type Hook = (
  input: HookInput,
  id: string | undefined,
  o: { signal: AbortSignal },
) => Promise<unknown>;

async function conectar(options: Options) {
  const server = options.mcpServers!.givance as unknown as {
    instance: { connect(t: unknown): Promise<void> };
  };
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.instance.connect(serverTransport);
  const client = new Client({ name: 'modelo-roteirizado', version: '1.0.0' });
  await client.connect(clientTransport);
  const pre = options.hooks!.PreToolUse![0]!.hooks[0] as Hook;
  const signal = new AbortController().signal;
  return async function chamar(agente: string, ferramenta: string, args: Record<string, unknown>) {
    const id = `tu-${randomUUID()}`;
    const quem = agente === 'orquestrador' ? {} : { agent_id: `sub-${agente}`, agent_type: agente };
    const decisao = (await pre(
      {
        session_id: 's',
        transcript_path: '/tmp/t',
        cwd: '/tmp',
        ...quem,
        hook_event_name: 'PreToolUse',
        tool_name: `mcp__givance__${ferramenta}`,
        tool_input: args,
        tool_use_id: id,
      } as HookInput,
      id,
      { signal },
    )) as { hookSpecificOutput?: { permissionDecision?: string } };
    if (decisao.hookSpecificOutput?.permissionDecision === 'deny') {
      return { negado: true, texto: '', erro: true };
    }
    const r = await client.callTool({ name: ferramenta, arguments: args });
    const texto = (r.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('\n');
    return { negado: false, texto, erro: r.isError === true };
  };
}

const fim = {
  type: 'result',
  subtype: 'success',
  result: 'Pronto.',
  total_cost_usd: 0.01,
  modelUsage: {},
  session_id: 's',
} as unknown as SDKMessage;

/** API do Instagram simulada: guarda o que seria enviado e deixa injetar falhas. */
function instagramFalso() {
  const chamadas: Array<{ metodo: string; dados?: unknown }> = [];
  const falhas: Partial<Record<keyof InstagramApi, unknown>> = {};
  const publicados: Array<{ id: string; caption: string }> = [];
  let seq = 0;
  const falhar = (metodo: keyof InstagramApi) => {
    const erro = falhas[metodo];
    if (erro) {
      delete falhas[metodo];
      throw erro;
    }
  };
  const containers = new Map<string, { caption: string; publicado: boolean }>();
  const api: InstagramApi = {
    async createImageContainer(input) {
      falhar('createImageContainer');
      chamadas.push({ metodo: 'createImageContainer', dados: input });
      const id = `cont-${++seq}`;
      containers.set(id, { caption: input.caption ?? '', publicado: false });
      return id;
    },
    async createVideoContainer(input) {
      chamadas.push({ metodo: 'createVideoContainer', dados: input });
      return `cont-${++seq}`;
    },
    async createCarouselContainer(input) {
      chamadas.push({ metodo: 'createCarouselContainer', dados: input });
      return `cont-${++seq}`;
    },
    async containerStatus(id) {
      chamadas.push({ metodo: 'containerStatus', dados: id });
      return { status: containers.get(id)?.publicado ? 'PUBLISHED' : 'FINISHED', detail: null };
    },
    async publish(id) {
      chamadas.push({ metodo: 'publish', dados: id });
      const c = containers.get(id)!;
      c.publicado = true;
      const mediaId = `midia-${publicados.length + 1}`;
      publicados.push({ id: mediaId, caption: c.caption });
      falhar('publish'); // falha DEPOIS de publicar: simula queda do processo
      return mediaId;
    },
    async media(id) {
      return {
        id,
        caption: null,
        mediaType: 'IMAGE',
        productType: 'FEED',
        permalink: `https://www.instagram.com/p/${id}/`,
        timestamp: new Date().toISOString(),
        likeCount: 0,
        commentsCount: 0,
      };
    },
    async listMedia() {
      falhar('listMedia');
      return publicados.map((p) => ({
        id: p.id,
        caption: p.caption,
        mediaType: 'IMAGE',
        productType: 'FEED',
        permalink: `https://www.instagram.com/p/${p.id}/`,
        timestamp: new Date().toISOString(),
        likeCount: 1,
        commentsCount: 0,
      }));
    },
    async insights() {
      return { reach: 10 };
    },
    async publishingLimit() {
      return { used: publicados.length, total: 100 };
    },
  };
  return { api, chamadas, falhas, publicados };
}

function whatsappFalso() {
  const envios: Array<{ tipo: string; dados: Record<string, unknown> }> = [];
  let n = 0;
  const client: WhatsAppDeps['client'] = {
    async sendText(_para, texto) {
      envios.push({ tipo: 'texto', dados: { texto } });
      return { messageId: `wamid.${++n}` };
    },
    async sendButtons(_para, input) {
      envios.push({ tipo: 'botoes', dados: input as unknown as Record<string, unknown> });
      return { messageId: `wamid.${++n}` };
    },
    async sendTemplate(_para, input) {
      envios.push({ tipo: 'template', dados: input as unknown as Record<string, unknown> });
      return { messageId: `wamid.${++n}` };
    },
    async markRead() {},
    async downloadMedia() {
      throw new Error('não usado');
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
let employeeId: string;
let connectionId: string;
let fotoId: string;
let agora = new Date();
const ig = instagramFalso();
const zap = whatsappFalso();
let deps: WorkerDeps;

const fila = (message: Record<string, unknown>, readCount = 1): QueueMessage => ({
  msgId: 0,
  readCount,
  enqueuedAt: new Date().toISOString(),
  message: { org_id: orgId, ...message },
});

async function comoDona<T>(fn: () => Promise<T>): Promise<T> {
  await pgc.query('begin');
  await pgc.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: DONA, role: 'authenticated' }),
  ]);
  await pgc.query('set local role authenticated');
  try {
    const r = await fn();
    await pgc.query('commit');
    return r;
  } catch (e) {
    await pgc.query('rollback');
    throw e;
  }
}

/** Roda uma tarefa em que o especialista social prepara o post pedido. */
async function prepararPost(args: Record<string, unknown>) {
  const { rows } = await pgc.query<{ id: string }>(
    `insert into tasks (org_id, employee_id, title, input, source)
     values ($1, $2, 'Post da promoção', $3, 'whatsapp') returning id`,
    [orgId, employeeId, JSON.stringify({ mensagem: 'posta essa foto', midias: [fotoId] })],
  );
  const taskId = rows[0]!.id;
  const vistos: Record<string, { negado: boolean; texto: string; erro: boolean }> = {};
  const roteiro: typeof query = async function* ({ options }: { options: Options }) {
    const chamar = await conectar(options);
    yield { type: 'system', subtype: 'init', session_id: 's' } as unknown as SDKMessage;
    vistos.listar = await chamar('social', 'midia_listar', {});
    vistos.copywriter = await chamar('copywriter', 'instagram_preparar_post', {
      formato: 'feed',
      midia_ids: [fotoId],
      motivo: 'não deveria poder',
    });
    vistos.preparar = await chamar('social', 'instagram_preparar_post', args);
    await chamar('orquestrador', 'cliente_responder', { mensagem: 'Mandei a prévia do post.' });
    yield fim;
  } as unknown as typeof query;
  await createTaskRunHandler({ ...deps, queryFn: roteiro, apiKey: 'sk-ant-teste' })(
    fila({ type: 'task.run', task_id: taskId }),
    new AbortController().signal,
  );
  const ap = await pgc.query<{ id: string; status: string; preview: Record<string, unknown> }>(
    `select id, status, preview from approvals where task_id = $1 and action_type = 'instagram.publicar'`,
    [taskId],
  );
  return { taskId, vistos, aprovacao: ap.rows[0] };
}

beforeAll(async () => {
  pgc = new pg.Client({ connectionString: DB_URL });
  await pgc.connect();
  slug = `teste-ig-${randomUUID().slice(0, 8)}`;
  const org = await pgc.query<{ id: string }>(
    `insert into organizations (name, slug) values ('Empresa do Teste de Instagram', $1) returning id`,
    [slug],
  );
  orgId = org.rows[0]!.id;
  await pgc.query(`insert into memberships (org_id, user_id, role) values ($1, $2, 'owner')`, [
    orgId,
    DONA,
  ]);
  await pgc.query(
    `insert into company_profiles (org_id, description, do_not_say) values ($1, 'Loja de teste', array['imperdível'])`,
    [orgId],
  );
  const contratado = await pgc.query<{ id: string }>(
    `select public.hire_employee($1, 'braco-direito', 1, 'Lia') as id`,
    [orgId],
  );
  employeeId = contratado.rows[0]!.id;
  await pgc.query(
    `insert into channels (org_id, user_id, address_e164, verified_at, last_inbound_at)
     values ($1, $2, $3, now(), now())`,
    [orgId, DONA, `+55119${String(Date.now()).slice(-8)}`],
  );
  const conexao = await pgc.query<{ id: string }>(
    `insert into connections (org_id, provider, external_ids, scopes, expires_at)
     values ($1, 'instagram', '{"ig_user_id":"1789","username":"loja_teste"}',
       array['instagram_business_basic','instagram_business_content_publish'], now() + interval '60 days')
     returning id`,
    [orgId],
  );
  connectionId = conexao.rows[0]!.id;
  await pgc.query(`select public.connection_secret_set($1, 'token-de-teste')`, [connectionId]);

  const db = createServiceClient({ url: SUPABASE_URL, secretKey: localSecretKey() });
  // Foto deitada (2000x1000): o post pede 4:5, então o worker precisa recortar.
  const jpeg = await sharp({
    create: { width: 2000, height: 1000, channels: 3, background: { r: 30, g: 120, b: 200 } },
  })
    .jpeg()
    .toBuffer();
  const caminho = `${orgId}/${randomUUID()}.jpg`;
  const up = await db.storage.from('midia').upload(caminho, jpeg, { contentType: 'image/jpeg' });
  if (up.error) throw up.error;
  const midia = await pgc.query<{ id: string }>(
    `insert into media_assets (org_id, storage_path, mime_type, size_bytes, source, width, height, caption)
     values ($1, $2, 'image/jpeg', $3, 'whatsapp', 2000, 1000, 'foto da vitrine') returning id`,
    [orgId, caminho, jpeg.length],
  );
  fotoId = midia.rows[0]!.id;

  deps = {
    db,
    services: createSupabaseToolServices(db, {
      instagram: createInstagramService({
        db,
        createClient: () => ig.api,
        sleep: async () => {},
      }),
    }),
    registry: createDefaultRegistry(),
    contentRoot: ROOT,
    logger: silentLogger,
    jobs: {},
    whatsapp: zap.wa,
    now: () => agora,
  };
});

afterAll(async () => {
  for (const f of ['tarefas', 'acoes', 'rotinas', 'whatsapp_saida']) {
    await pgc.query(`delete from pgmq.q_${f} where message ->> 'org_id' = $1`, [orgId]);
  }
  await purgeOrganization(deps.db, orgId, slug);
  // LGPD: nenhum arquivo da empresa fica para trás, nem as fotos recortadas em subpastas.
  const sobras = await pgc.query<{ n: number }>(
    `select count(*)::int as n from storage.objects where bucket_id = 'midia' and name like $1`,
    [`${orgId}/%`],
  );
  await pgc.end();
  expect(sobras.rows[0]!.n).toBe(0);
});

describe('post no Instagram', () => {
  it('prepara, mostra a foto na prévia, publica com recorte 4:5 e devolve o link', async () => {
    const { taskId, vistos, aprovacao } = await prepararPost({
      formato: 'feed',
      legenda: 'Vitrine nova chegando! #novidade',
      midia_ids: [fotoId],
      recorte: '4:5',
      motivo: 'Dono mandou a foto da vitrine',
    });
    expect(vistos.listar!.texto).toContain(`${fotoId}: foto 2000x1000`);
    expect(vistos.listar!.texto).toContain('[anexada a esta tarefa]');
    expect(vistos.copywriter!.negado).toBe(true);
    expect(vistos.preparar!.erro).toBe(false);
    expect(aprovacao).toMatchObject({ status: 'pendente' });
    expect(aprovacao!.preview).toMatchObject({ midia_ids: [fotoId], botao_aprovar: 'Publicar' });

    const post = await pgc.query(
      `select status, format, crop from social_posts where approval_id = $1`,
      [aprovacao!.id],
    );
    expect(post.rows[0]).toEqual({ status: 'aguardando_confirmacao', format: 'feed', crop: '4:5' });
    const tarefa = await pgc.query('select status from tasks where id = $1', [taskId]);
    expect(tarefa.rows[0]).toEqual({ status: 'aguardando_aprovacao' });

    // Prévia no WhatsApp com a foto no cabeçalho e o botão "Publicar".
    await createWhatsAppOutboundHandler(deps)(
      fila({ type: 'approval.notify', approval_id: aprovacao!.id }),
    );
    const previa = zap.envios.at(-1)!;
    expect(previa.tipo).toBe('botoes');
    expect(String(previa.dados.headerImageUrl)).toMatch(/\/storage\/v1\/object\/sign\/midia\//);
    expect((previa.dados.buttons as Array<{ title: string }>)[0]!.title).toBe('Publicar');

    await comoDona(() =>
      pgc.query(`select public.decide_approval($1, 'aprovar')`, [aprovacao!.id]),
    );
    await createActionExecuteHandler(
      deps,
      4,
    )(fila({ type: 'action.execute', approval_id: aprovacao!.id }));

    // O Instagram recebeu um JPEG 4:5 por URL assinada.
    const criado = ig.chamadas.find((c) => c.metodo === 'createImageContainer')!.dados as {
      imageUrl: string;
      caption: string;
    };
    expect(criado.caption).toBe('Vitrine nova chegando! #novidade');
    const baixado = Buffer.from(await (await fetch(criado.imageUrl)).arrayBuffer());
    const meta = await sharp(baixado).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 800, 1000]);

    const publicado = await pgc.query(
      `select status, ig_media_id, permalink from social_posts where approval_id = $1`,
      [aprovacao!.id],
    );
    expect(publicado.rows[0]).toEqual({
      status: 'publicado',
      ig_media_id: 'midia-1',
      permalink: 'https://www.instagram.com/p/midia-1/',
    });
    const exec = await pgc.query(
      `select status, external_ids from action_executions where approval_id = $1`,
      [aprovacao!.id],
    );
    expect(exec.rows[0]).toMatchObject({
      status: 'sucesso',
      external_ids: { ig_media_id: 'midia-1' },
    });
    // A tarefa volta ao orquestrador para mandar o link.
    const depois = await pgc.query('select status from tasks where id = $1', [taskId]);
    expect(depois.rows[0]).toEqual({ status: 'a_fazer' });
  });

  it('legenda com termo proibido pela empresa não vira aprovação', async () => {
    const { vistos, aprovacao } = await prepararPost({
      formato: 'feed',
      legenda: 'Promoção imperdível!',
      midia_ids: [fotoId],
      motivo: 'teste',
    });
    expect(vistos.preparar!.erro).toBe(true);
    expect(vistos.preparar!.texto).toContain('não usa o termo "imperdível"');
    expect(aprovacao).toBeUndefined();
  });

  it('agendado: segura até o horário, libera a tarefa e avisa o dono com o link depois', async () => {
    const quando = new Date(Date.now() + 2 * 86_400_000);
    const { taskId, aprovacao } = await prepararPost({
      formato: 'feed',
      legenda: 'Post agendado de sexta',
      midia_ids: [fotoId],
      agendar_para: quando.toISOString(),
      motivo: 'Melhor horário da semana',
    });
    expect(aprovacao!.preview).toMatchObject({ botao_aprovar: 'Agendar' });
    await comoDona(() =>
      pgc.query(`select public.decide_approval($1, 'aprovar')`, [aprovacao!.id]),
    );

    agora = new Date();
    const espera = await createActionExecuteHandler(
      deps,
      4,
    )(fila({ type: 'action.execute', approval_id: aprovacao!.id })).catch((e: unknown) => e);
    expect(espera).toBeInstanceOf(DeferError);
    expect((espera as DeferError).seconds).toBeGreaterThan(2 * 86_400 - 120);
    const agendado = await pgc.query(`select status from social_posts where approval_id = $1`, [
      aprovacao!.id,
    ]);
    expect(agendado.rows[0]).toEqual({ status: 'agendado' });
    const liberada = await pgc.query('select status from tasks where id = $1', [taskId]);
    expect(liberada.rows[0]).toEqual({ status: 'a_fazer' });
    const exec0 = await pgc.query(
      `select count(*)::int as n from action_executions where approval_id = $1`,
      [aprovacao!.id],
    );
    expect(exec0.rows[0]).toEqual({ n: 0 });

    // A tarefa terminou (o orquestrador confirmou o agendamento).
    await pgc.query(`update tasks set status = 'concluida', finished_at = now() where id = $1`, [
      taskId,
    ]);
    agora = new Date(quando.getTime() + 60_000);
    await createActionExecuteHandler(
      deps,
      4,
    )(fila({ type: 'action.execute', approval_id: aprovacao!.id }));
    const aviso = await pgc.query<{ content: string }>(
      `select content from messages where task_id = $1 and author = 'funcionario' order by created_at desc limit 1`,
      [taskId],
    );
    expect(aviso.rows[0]!.content).toBe(
      'Post publicado no Instagram: https://www.instagram.com/p/midia-2/',
    );
  });

  it('queda depois de publicar: a nova tentativa acha o post e não publica de novo', async () => {
    const { aprovacao } = await prepararPost({
      formato: 'feed',
      legenda: 'Post da queda',
      midia_ids: [fotoId],
      motivo: 'teste de retomada',
    });
    await comoDona(() =>
      pgc.query(`select public.decide_approval($1, 'aprovar')`, [aprovacao!.id]),
    );
    ig.falhas.publish = new InstagramError('Falha de rede', 0, undefined, true);
    const antes = ig.publicados.length;

    await expect(
      createActionExecuteHandler(
        deps,
        4,
      )(fila({ type: 'action.execute', approval_id: aprovacao!.id })),
    ).rejects.toThrow();
    await createActionExecuteHandler(
      deps,
      4,
    )(fila({ type: 'action.execute', approval_id: aprovacao!.id }, 2));

    expect(ig.publicados.length).toBe(antes + 1);
    const post = await pgc.query(
      `select status, ig_media_id from social_posts where approval_id = $1`,
      [aprovacao!.id],
    );
    expect(post.rows[0]).toEqual({ status: 'publicado', ig_media_id: `midia-${antes + 1}` });
  });

  it('token revogado: a ação falha sem nova tentativa e a conexão fica para reconectar', async () => {
    const { aprovacao } = await prepararPost({
      formato: 'feed',
      legenda: 'Post do token',
      midia_ids: [fotoId],
      motivo: 'teste de token',
    });
    await comoDona(() =>
      pgc.query(`select public.decide_approval($1, 'aprovar')`, [aprovacao!.id]),
    );
    ig.falhas.createImageContainer = new InstagramError('Session expired', 400, 190, false);
    await createActionExecuteHandler(
      deps,
      4,
    )(fila({ type: 'action.execute', approval_id: aprovacao!.id }));
    const exec = await pgc.query<{ status: string; error: string }>(
      `select status, error from action_executions where approval_id = $1`,
      [aprovacao!.id],
    );
    expect(exec.rows[0]!.status).toBe('falhou');
    expect(exec.rows[0]!.error).toMatch(/reconectar a conta/);
    const conexao = await pgc.query('select status from connections where id = $1', [connectionId]);
    expect(conexao.rows[0]).toEqual({ status: 'expirada' });
    const post = await pgc.query('select status from social_posts where approval_id = $1', [
      aprovacao!.id,
    ]);
    expect(post.rows[0]).toEqual({ status: 'falhou' });
  });
});
