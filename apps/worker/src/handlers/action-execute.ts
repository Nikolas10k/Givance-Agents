import { errorMessage } from '@givance/core';
import { tasksRepo, type QueueMessage } from '@givance/db';
import { executeApprovedAction } from '@givance/tools';
import { DeferError } from '../consumer';
import type { WorkerDeps } from '../deps';
import { actionExecuteMessage, parseMessage } from '../messages';

/** Falha temporária da ação: o consumidor tenta de novo com espera. */
class RetryAction extends Error {}

/** Margem para não segurar de novo uma ação que já está a segundos do horário. */
const MARGEM_AGENDAMENTO_MS = 30_000;

/**
 * Executa uma ação aprovada (ou aprovada automaticamente). Ações com horário (post agendado)
 * ficam na fila, já aprovadas, até a hora. Depois da execução, se nada mais estiver pendente
 * na tarefa, devolve a tarefa ao orquestrador para ele avisar o dono do resultado; se a
 * tarefa já terminou (caso do agendado), avisa o dono direto no WhatsApp.
 */
export function createActionExecuteHandler(deps: WorkerDeps, maxAttempts: number) {
  const tasks = tasksRepo(deps.db);

  return async function handleActionExecute(message: QueueMessage): Promise<void> {
    const body = parseMessage(actionExecuteMessage, message.message);
    const orgId = body.org_id;
    const log = deps.logger.child({ orgId, approvalId: body.approval_id });

    const approval = await deps.services.approvals.get(orgId, body.approval_id);
    if (!approval) {
      log.warn('Aprovação não encontrada; mensagem ignorada');
      return;
    }
    const task = await tasks.get(orgId, approval.taskId);
    if (!task) {
      log.warn('Tarefa da aprovação não encontrada');
      return;
    }

    const definition = deps.registry.getAction(approval.actionType);
    if (
      definition?.notBefore &&
      (approval.status === 'aprovada' || approval.status === 'editada')
    ) {
      const parsed = definition.payload.safeParse(approval.editedPayload ?? approval.payload);
      const quando = parsed.success ? definition.notBefore(parsed.data) : null;
      const agora = deps.now?.() ?? new Date();
      if (quando && quando.getTime() - agora.getTime() > MARGEM_AGENDAMENTO_MS) {
        const primeiraVez = definition.onScheduled
          ? await definition.onScheduled(
              {
                task: {
                  orgId,
                  taskId: approval.taskId,
                  employeeId: task.employee_id,
                  runId: approval.runId,
                  taskSource: 'sistema',
                },
                services: deps.services,
                approvalId: approval.id,
              },
              parsed.success ? parsed.data : undefined,
              quando,
            )
          : false;
        if (primeiraVez) {
          // Libera a tarefa: o orquestrador confirma o agendamento ao dono e encerra.
          await tasks.resumeIfIdle(orgId, approval.taskId);
          log.info('Ação agendada', { para: quando.toISOString() });
        }
        throw new DeferError((quando.getTime() - agora.getTime()) / 1000);
      }
    }

    const result = await executeApprovedAction({
      services: deps.services,
      registry: deps.registry,
      orgId,
      approvalId: approval.id,
      employeeId: task.employee_id,
    });

    if (result.status === 'falhou' && result.retryable && message.readCount < maxAttempts) {
      throw new RetryAction(result.error);
    }
    log.info('Ação processada', { status: result.status });

    if (!result.taskId) return;
    const retomada = await tasks.resumeIfIdle(orgId, result.taskId);
    if (!retomada && result.status !== 'ignorada') {
      // A tarefa já tinha terminado (ex.: post agendado): o dono fica sabendo por aqui.
      const texto =
        result.status === 'sucesso'
          ? result.summary
          : `Não consegui concluir uma ação que estava agendada: ${result.error}`;
      try {
        await deps.services.messages.notifyOwner({
          orgId,
          employeeId: task.employee_id,
          taskId: result.taskId,
          content: texto,
        });
      } catch (error) {
        log.warn('Falha ao avisar o dono do resultado', { erro: errorMessage(error) });
      }
    }
  };
}
