import { errorMessage, type QueueName } from '@givance/core';
import type { QueueMessage } from '@givance/db';
import type { Logger } from './logger';

/** Erro que não adianta repetir: a mensagem é descartada na hora. */
/** Não é falha: a mensagem deve voltar à fila depois de `seconds` (ex.: horário de silêncio). */
export class DeferError extends Error {
  constructor(readonly seconds: number) {
    super(`Adiado por ${seconds}s`);
    this.name = 'DeferError';
  }
}

export class PermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentError';
  }
}

export interface QueueClient {
  read(queue: QueueName, visibilitySeconds: number, quantity: number): Promise<QueueMessage[]>;
  archive(queue: QueueName, msgId: number): Promise<void>;
  setVisibility(queue: QueueName, msgId: number, seconds: number): Promise<void>;
}

export interface ConsumerOptions {
  queue: QueueName;
  client: QueueClient;
  handler: (message: QueueMessage, signal: AbortSignal) => Promise<void>;
  /** Tempo de invisibilidade de uma mensagem lida; renovado enquanto o handler roda. */
  visibilitySeconds: number;
  concurrency: number;
  maxAttempts: number;
  pollIntervalMs: number;
  logger: Logger;
  onDeadLetter?: (message: QueueMessage, error: unknown) => Promise<void>;
  /** Espera antes da próxima tentativa (segundos), dado o número de leituras. */
  backoffSeconds?: (readCount: number) => number;
}

const defaultBackoff = (readCount: number) => Math.min(30 * 2 ** (readCount - 1), 900);

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * Consome uma fila pgmq: lê até `concurrency` mensagens, mantém cada uma invisível enquanto
 * é processada (batimento), arquiva quando dá certo e, quando falha, devolve com espera
 * exponencial até `maxAttempts` leituras. Depois disso, descarta e avisa (onDeadLetter).
 */
export class QueueConsumer {
  private readonly active = new Map<number, AbortController>();
  private readonly stopping = new AbortController();
  private loop: Promise<void> | undefined;

  constructor(private readonly options: ConsumerOptions) {}

  get activeCount(): number {
    return this.active.size;
  }

  start(): void {
    this.loop ??= this.run();
  }

  /** Para de ler, avisa os handlers em andamento e espera até `timeoutMs`. */
  async stop(timeoutMs = 30_000): Promise<void> {
    this.stopping.abort();
    for (const controller of this.active.values()) controller.abort();
    const deadline = Date.now() + timeoutMs;
    while (this.active.size > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    await this.loop;
  }

  private async run(): Promise<void> {
    const { queue, client, logger } = this.options;
    const signal = this.stopping.signal;
    let falhasSeguidas = 0;
    while (!signal.aborted) {
      const livres = this.options.concurrency - this.active.size;
      if (livres <= 0) {
        await sleep(200, signal);
        continue;
      }
      let messages: QueueMessage[];
      try {
        messages = await client.read(queue, this.options.visibilitySeconds, livres);
        falhasSeguidas = 0;
      } catch (error) {
        falhasSeguidas += 1;
        logger.error('Falha ao ler a fila', { queue, erro: errorMessage(error) });
        await sleep(Math.min(1_000 * 2 ** falhasSeguidas, 30_000), signal);
        continue;
      }
      if (messages.length === 0) {
        await sleep(this.options.pollIntervalMs, signal);
        continue;
      }
      for (const message of messages) {
        void this.process(message);
      }
    }
  }

  private async process(message: QueueMessage): Promise<void> {
    const { queue, client, logger } = this.options;
    const controller = new AbortController();
    this.active.set(message.msgId, controller);
    const log = logger.child({ queue, msgId: message.msgId, leitura: message.readCount });

    const intervaloMs = Math.max(5, Math.floor(this.options.visibilitySeconds / 2)) * 1_000;
    const heartbeat = setInterval(() => {
      client
        .setVisibility(queue, message.msgId, this.options.visibilitySeconds)
        .catch((error) =>
          log.warn('Falha ao renovar a invisibilidade', { erro: errorMessage(error) }),
        );
    }, intervaloMs);

    try {
      await this.options.handler(message, controller.signal);
      await client.archive(queue, message.msgId);
    } catch (error) {
      if (error instanceof DeferError && message.readCount < 50) {
        log.debug('Mensagem adiada', { segundos: error.seconds });
        await client
          .setVisibility(queue, message.msgId, Math.max(1, Math.round(error.seconds)))
          .catch(() => undefined);
        return;
      }
      const esgotou =
        message.readCount >= this.options.maxAttempts || error instanceof PermanentError;
      if (esgotou) {
        log.error('Mensagem descartada', { erro: errorMessage(error) });
        await client.archive(queue, message.msgId).catch(() => undefined);
        await this.options
          .onDeadLetter?.(message, error)
          .catch((e) =>
            log.error('Falha ao tratar mensagem descartada', { erro: errorMessage(e) }),
          );
      } else {
        const espera = (this.options.backoffSeconds ?? defaultBackoff)(message.readCount);
        log.warn('Falha no processamento; nova tentativa agendada', {
          erro: errorMessage(error),
          espera,
        });
        await client.setVisibility(queue, message.msgId, espera).catch(() => undefined);
      }
    } finally {
      clearInterval(heartbeat);
      this.active.delete(message.msgId);
    }
  }
}
