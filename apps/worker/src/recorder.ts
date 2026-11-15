import { errorMessage } from '@givance/core';
import { runsRepo, type TypedClient } from '@givance/db';
import type { StepRecorder } from '@givance/agents';
import type { Logger } from './logger';

/**
 * Grava o rastro de uma execução em agent_steps. As gravações vão numa fila em memória para
 * não segurar o agente; flush() espera todas antes de fechar a execução.
 */
export function createStepRecorder(
  db: TypedClient,
  orgId: string,
  runId: string,
  logger: Logger,
): StepRecorder & { flush(): Promise<void> } {
  const runs = runsRepo(db);
  const inputs = new Map<string, unknown>();
  let chain: Promise<void> = Promise.resolve();

  const enqueue = (step: Parameters<typeof runs.addStep>[2]) => {
    chain = chain
      .then(() => runs.addStep(orgId, runId, step))
      .catch((error) =>
        logger.warn('Falha ao gravar passo da execução', { erro: errorMessage(error) }),
      );
  };

  return {
    toolStarted(event) {
      inputs.set(event.toolUseId, event.input);
    },
    toolFinished(event) {
      enqueue({
        agent: event.agent,
        kind: event.toolName === 'Agent' || event.toolName === 'Task' ? 'delegacao' : 'tool_call',
        toolName: event.toolName,
        toolUseId: event.toolUseId,
        status: event.status,
        input: inputs.get(event.toolUseId),
        output: event.output,
        ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
      });
      inputs.delete(event.toolUseId);
    },
    toolDenied(event) {
      enqueue({
        agent: event.agent,
        kind: 'tool_call',
        toolName: event.toolName,
        toolUseId: event.toolUseId,
        status: 'negado',
        output: { motivo: event.reason },
      });
    },
    delegated(event) {
      if (event.phase === 'fim') {
        enqueue({
          agent: event.agent,
          kind: 'mensagem',
          output: { resumo: event.summary ?? null },
        });
      }
    },
    flush: () => chain,
  };
}
