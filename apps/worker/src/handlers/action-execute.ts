import { tasksRepo, type QueueMessage } from '@givance/db';
import { executeApprovedAction } from '@givance/tools';
import type { WorkerDeps } from '../deps';
import { actionExecuteMessage, parseMessage } from '../messages';

/** Falha temporária da ação: o consumidor tenta de novo com espera. */
class RetryAction extends Error {}

/**
 * Executa uma ação aprovada (ou aprovada automaticamente). Depois, se nada mais estiver
 * pendente na tarefa, devolve a tarefa ao orquestrador para ele avisar o dono do resultado.
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

    if (result.taskId) {
      await tasks.resumeIfIdle(orgId, result.taskId);
    }
  };
}
