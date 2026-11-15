import type { QueueMessage } from '@givance/db';
import { describe, expect, it } from 'vitest';
import { PermanentError, QueueConsumer, type QueueClient } from './consumer';
import { silentLogger } from './logger';

function fila(mensagens: QueueMessage[]) {
  const eventos: string[] = [];
  const client: QueueClient = {
    async read() {
      return mensagens.splice(0, mensagens.length);
    },
    async archive(_q, id) {
      eventos.push(`arquivada:${id}`);
    },
    async setVisibility(_q, id, s) {
      eventos.push(`visibilidade:${id}:${s}`);
    },
  };
  return { client, eventos };
}

const msg = (msgId: number, readCount = 1): QueueMessage => ({
  msgId,
  readCount,
  enqueuedAt: new Date().toISOString(),
  message: {},
});

async function rodar(
  mensagens: QueueMessage[],
  handler: (m: QueueMessage) => Promise<void>,
  extra: { onDeadLetter?: (m: QueueMessage, e: unknown) => Promise<void> } = {},
) {
  const { client, eventos } = fila(mensagens);
  const consumer = new QueueConsumer({
    queue: 'tarefas',
    client,
    handler,
    visibilitySeconds: 60,
    concurrency: 2,
    maxAttempts: 3,
    pollIntervalMs: 10,
    logger: silentLogger,
    backoffSeconds: (n) => n * 10,
    ...extra,
  });
  consumer.start();
  await new Promise((r) => setTimeout(r, 80));
  await consumer.stop(1_000);
  return eventos;
}

describe('consumidor de fila', () => {
  it('arquiva a mensagem quando o handler termina', async () => {
    expect(await rodar([msg(1)], async () => {})).toEqual(['arquivada:1']);
  });

  it('falha temporária: devolve à fila com espera crescente', async () => {
    const eventos = await rodar([msg(2, 2)], async () => {
      throw new Error('instável');
    });
    expect(eventos).toEqual(['visibilidade:2:20']);
  });

  it('esgotadas as tentativas ou erro permanente: descarta e avisa', async () => {
    const descartadas: number[] = [];
    const onDeadLetter = async (m: QueueMessage) => {
      descartadas.push(m.msgId);
    };
    const eventos = await rodar(
      [msg(3, 3), msg(4, 1)],
      async (m) => {
        throw m.msgId === 4 ? new PermanentError('corpo inválido') : new Error('de novo');
      },
      { onDeadLetter },
    );
    expect(eventos.sort()).toEqual(['arquivada:3', 'arquivada:4']);
    expect(descartadas.sort()).toEqual([3, 4]);
  });

  it('ao parar, avisa os handlers em andamento pelo sinal', async () => {
    let cancelado = false;
    const { client } = fila([msg(5)]);
    const consumer = new QueueConsumer({
      queue: 'tarefas',
      client,
      handler: (_m, signal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => {
            cancelado = true;
            resolve();
          });
        }),
      visibilitySeconds: 60,
      concurrency: 1,
      maxAttempts: 3,
      pollIntervalMs: 10,
      logger: silentLogger,
    });
    consumer.start();
    await new Promise((r) => setTimeout(r, 50));
    expect(consumer.activeCount).toBe(1);
    await consumer.stop(1_000);
    expect(cancelado).toBe(true);
    expect(consumer.activeCount).toBe(0);
  });
});
