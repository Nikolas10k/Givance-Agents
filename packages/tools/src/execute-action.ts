import { errorMessage, formatZodIssues, redact } from '@givance/core';
import type { ActionLookup } from './definitions';
import type { TaskContext, ToolServices } from './types';

export type ExecuteActionResult =
  | { status: 'sucesso'; summary: string; taskId: string }
  | { status: 'ignorada'; reason: string; taskId: string | null }
  | { status: 'falhou'; error: string; retryable: boolean; taskId: string };

/** Erro que vale a pena tentar de novo (rede, limite de taxa, indisponibilidade). */
export class RetryableActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableActionError';
  }
}

/**
 * Executa uma ação aprovada exatamente uma vez: revalida o payload aprovado (ou o editado
 * pelo dono), roda os guards de novo e chama a implementação. Nunca chama o modelo.
 */
export async function executeApprovedAction(deps: {
  services: ToolServices;
  registry: ActionLookup;
  orgId: string;
  approvalId: string;
  employeeId: string;
}): Promise<ExecuteActionResult> {
  const { services, registry, orgId, approvalId } = deps;
  const approval = await services.approvals.get(orgId, approvalId);
  if (!approval) {
    return { status: 'ignorada', reason: 'Aprovação não encontrada.', taskId: null };
  }
  if (approval.status !== 'aprovada' && approval.status !== 'editada') {
    return {
      status: 'ignorada',
      reason: `Aprovação não está aprovada (situação: ${approval.status}).`,
      taskId: approval.taskId,
    };
  }
  if (await services.executions.hasSucceeded(orgId, approvalId)) {
    return { status: 'ignorada', reason: 'Ação já executada.', taskId: approval.taskId };
  }

  const task: TaskContext = {
    orgId,
    taskId: approval.taskId,
    employeeId: deps.employeeId,
    runId: approval.runId,
    taskSource: 'sistema',
  };

  const audit = (action: string, payload: unknown, reason?: string) =>
    services.audit.log({
      orgId,
      actorType: 'sistema',
      actorId: 'executor',
      action,
      target: `approval:${approvalId}`,
      reason,
      taskId: approval.taskId,
      runId: approval.runId,
      payload: redact(payload),
    });

  const definition = registry.getAction(approval.actionType);
  const execution = await services.executions.start(orgId, approvalId);
  if (!execution) {
    return {
      status: 'ignorada',
      reason: 'Outra tentativa desta ação está em andamento ou já terminou.',
      taskId: approval.taskId,
    };
  }

  const fail = async (error: string, retryable: boolean): Promise<ExecuteActionResult> => {
    await services.executions.fail(orgId, execution.id, error);
    await audit('acao.falhou', { tipo: approval.actionType, tentativa: execution.attempt }, error);
    return { status: 'falhou', error, retryable, taskId: approval.taskId };
  };

  if (!definition) {
    return fail(`Tipo de ação sem implementação: ${approval.actionType}.`, false);
  }

  const parsed = definition.payload.safeParse(approval.editedPayload ?? approval.payload);
  if (!parsed.success) {
    return fail(`Dados inválidos: ${formatZodIssues(parsed.error).join('; ')}`, false);
  }

  let payload = parsed.data;
  if (definition.guard) {
    const guarded = await definition.guard({ task, services, phase: 'execucao' }, payload);
    if (!guarded.ok) {
      return fail(`Barrada pelas regras de segurança: ${guarded.problems.join('; ')}`, false);
    }
    payload = guarded.payload;
  }

  try {
    const outcome = await definition.execute(
      {
        task,
        services,
        approvalId,
        idempotencyKey: approval.idempotencyKey,
        attempt: execution.attempt,
      },
      payload,
    );
    await services.executions.succeed(orgId, execution.id, {
      summary: outcome.summary,
      externalIds: outcome.externalIds ?? {},
    });
    await audit('acao.executada', {
      tipo: approval.actionType,
      tentativa: execution.attempt,
      resumo: outcome.summary,
      ids_externos: outcome.externalIds ?? {},
    });
    return { status: 'sucesso', summary: outcome.summary, taskId: approval.taskId };
  } catch (error) {
    return fail(errorMessage(error), error instanceof RetryableActionError);
  }
}
