import { createServer } from 'node:http';
import { resolveContentRoot } from '@givance/agents';
import { errorMessage } from '@givance/core';
import { createSupabaseToolServices, queueRepo, tasksRepo } from '@givance/db';
import { createServiceClient } from '@givance/db/service';
import { createWhatsAppClient } from '@givance/integrations';
import { createDefaultRegistry } from '@givance/tools';
import { loadConfig } from './config';
import { QueueConsumer } from './consumer';
import type { JobHandler, WorkerDeps } from './deps';
import { createActionExecuteHandler } from './handlers/action-execute';
import { createRoutineFireHandler, scheduleUnscheduledRoutines } from './handlers/routine-fire';
import { createTaskRunHandler } from './handlers/task-run';
import { createWhatsAppInboundHandler } from './handlers/whatsapp-inbound';
import { createWhatsAppOutboundHandler } from './handlers/whatsapp-outbound';
import { createInstagramService, refreshInstagramTokens } from './instagram/service';
import { createLogger } from './logger';
import { taskRunMessage } from './messages';

/** Jobs de sistema implementados nesta versão (Fase 1a: nenhum). */
const JOBS: Record<string, JobHandler> = {};

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL, { servico: 'worker' });
  const db = createServiceClient({
    url: config.SUPABASE_URL,
    secretKey: config.SUPABASE_SECRET_KEY,
  });
  const deps: WorkerDeps = {
    db,
    services: createSupabaseToolServices(db, {
      instagram: createInstagramService({ db, graphVersion: config.INSTAGRAM_GRAPH_VERSION }),
    }),
    registry: createDefaultRegistry(),
    contentRoot: resolveContentRoot(),
    ...(config.ANTHROPIC_API_KEY ? { apiKey: config.ANTHROPIC_API_KEY } : {}),
    logger,
    jobs: JOBS,
    ...(config.WHATSAPP_PHONE_NUMBER_ID && config.WHATSAPP_ACCESS_TOKEN
      ? {
          whatsapp: {
            client: createWhatsAppClient({
              phoneNumberId: config.WHATSAPP_PHONE_NUMBER_ID,
              accessToken: config.WHATSAPP_ACCESS_TOKEN,
              graphVersion: config.WHATSAPP_GRAPH_VERSION,
            }),
            templates: {
              aviso: config.WHATSAPP_TEMPLATE_AVISO,
              confirmacao: config.WHATSAPP_TEMPLATE_CONFIRMACAO,
              idioma: config.WHATSAPP_TEMPLATE_IDIOMA,
            },
          },
        }
      : {}),
  };
  if (!deps.apiKey) {
    logger.warn(
      'ANTHROPIC_API_KEY não definida: as tarefas serão marcadas como falhas com explicação.',
    );
  }

  const queue = queueRepo(db);
  const common = { client: queue, pollIntervalMs: config.WORKER_POLL_INTERVAL_MS, logger };
  const consumers: QueueConsumer[] = [
    new QueueConsumer({
      ...common,
      queue: 'tarefas',
      handler: createTaskRunHandler(deps),
      visibilitySeconds: 600,
      concurrency: config.WORKER_CONCURRENCY,
      maxAttempts: 5,
      onDeadLetter: async (message, error) => {
        const parsed = taskRunMessage.safeParse(message.message);
        if (parsed.success) {
          await tasksRepo(db).finish(parsed.data.org_id, parsed.data.task_id, {
            status: 'falhou',
            error: `Erro do worker: ${errorMessage(error)}`,
          });
        }
      },
    }),
    new QueueConsumer({
      ...common,
      queue: 'acoes',
      handler: createActionExecuteHandler(deps, 4),
      visibilitySeconds: 300,
      concurrency: 4,
      maxAttempts: 4,
    }),
    new QueueConsumer({
      ...common,
      queue: 'rotinas',
      handler: createRoutineFireHandler(deps),
      visibilitySeconds: 120,
      concurrency: 4,
      maxAttempts: 3,
    }),
  ];

  if (deps.whatsapp) {
    consumers.push(
      new QueueConsumer({
        ...common,
        queue: 'whatsapp_entrada',
        handler: createWhatsAppInboundHandler(deps),
        visibilitySeconds: 120,
        concurrency: 4,
        maxAttempts: 5,
      }),
      new QueueConsumer({
        ...common,
        queue: 'whatsapp_saida',
        handler: createWhatsAppOutboundHandler(deps),
        visibilitySeconds: 60,
        concurrency: 4,
        maxAttempts: 6,
      }),
    );
  } else {
    logger.warn('WhatsApp não configurado: mensagens ficam na fila até o canal ser ligado.');
  }

  const agendar = async () => {
    try {
      const n = await scheduleUnscheduledRoutines(deps);
      if (n > 0) logger.info('Rotinas agendadas', { quantidade: n });
    } catch (error) {
      logger.error('Falha ao agendar rotinas', { erro: errorMessage(error) });
    }
  };
  await agendar();
  const agendador = setInterval(agendar, 60_000);

  const renovarTokens = async () => {
    try {
      const r = await refreshInstagramTokens(db);
      if (r.renovados + r.expirados > 0) logger.info('Tokens do Instagram', r);
    } catch (error) {
      logger.error('Falha ao renovar tokens do Instagram', { erro: errorMessage(error) });
    }
  };
  void renovarTokens();
  const renovador = setInterval(renovarTokens, 6 * 3_600_000);

  consumers.forEach((c) => c.start());
  const startedAt = new Date().toISOString();
  const health = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({ ok: true, startedAt, emAndamento: consumers.map((c) => c.activeCount) }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  health.listen(config.PORT, () => logger.info('Worker no ar', { porta: config.PORT }));

  let encerrando = false;
  const encerrar = async (sinal: string) => {
    if (encerrando) return;
    encerrando = true;
    logger.info('Encerrando worker', { sinal });
    clearInterval(agendador);
    clearInterval(renovador);
    await Promise.all(consumers.map((c) => c.stop(60_000)));
    health.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void encerrar('SIGTERM'));
  process.on('SIGINT', () => void encerrar('SIGINT'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
