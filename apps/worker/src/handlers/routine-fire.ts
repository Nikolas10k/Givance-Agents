import { computeNextRun, errorMessage } from '@givance/core';
import { routinesRepo, tasksRepo, type QueueMessage, type RoutineRow } from '@givance/db';
import type { WorkerDeps } from '../deps';
import { parseMessage, routineFireMessage } from '../messages';

/** Próximo horário de uma rotina, ou o motivo de não conseguir calcular. */
export function nextRunFor(routine: Pick<RoutineRow, 'cron' | 'timezone'>, from: Date) {
  try {
    return { next: computeNextRun(routine.cron, routine.timezone, from), error: null };
  } catch (error) {
    return { next: null, error: errorMessage(error) };
  }
}

/**
 * Dispara uma rotina vencida: cria a tarefa (rotina "tarefa") ou roda o job de sistema, e
 * agenda o próximo horário. Jobs ainda não implementados voltam para "sem agenda".
 */
export function createRoutineFireHandler(deps: WorkerDeps) {
  const routines = routinesRepo(deps.db);
  const tasks = tasksRepo(deps.db);

  return async function handleRoutineFire(message: QueueMessage): Promise<void> {
    const body = parseMessage(routineFireMessage, message.message);
    const orgId = body.org_id;
    const now = deps.now?.() ?? new Date();
    const log = deps.logger.child({ orgId, routineId: body.routine_id });

    const routine = await routines.get(orgId, body.routine_id);
    if (!routine) {
      log.warn('Rotina não encontrada');
      return;
    }
    if (!routine.enabled) {
      await routines.schedule(orgId, routine.id, { nextRunAt: null });
      return;
    }

    if (routine.kind === 'job') {
      const job = routine.job_type ? deps.jobs[routine.job_type] : undefined;
      if (!job) {
        log.debug('Job ainda não implementado; rotina fica sem agenda', { job: routine.job_type });
        await routines.schedule(orgId, routine.id, { nextRunAt: null });
        return;
      }
      await job({ orgId, employeeId: routine.employee_id, routineId: routine.id });
    } else {
      const template = (routine.task_template ?? {}) as Record<string, unknown>;
      const instrucoes =
        typeof template.instrucoes === 'string' ? template.instrucoes : routine.routine_key;
      const titulo =
        typeof template.titulo === 'string' ? template.titulo : `Rotina: ${routine.routine_key}`;
      await tasks.createFromRoutine({
        orgId,
        employeeId: routine.employee_id,
        routineId: routine.id,
        title: titulo,
        instructions: instrucoes,
        ...(typeof template.agente_inicial === 'string'
          ? { initialAgent: template.agente_inicial }
          : {}),
      });
    }

    const { next, error } = nextRunFor(routine, now);
    await routines.schedule(orgId, routine.id, { nextRunAt: next, ranAt: now, error });
    log.info('Rotina disparada', { proxima: next?.toISOString() ?? null });
  };
}

/** Calcula o próximo horário das rotinas recém-criadas ou alteradas (todas as empresas). */
export async function scheduleUnscheduledRoutines(deps: WorkerDeps): Promise<number> {
  const routines = routinesRepo(deps.db);
  const now = deps.now?.() ?? new Date();
  let agendadas = 0;
  for (const routine of await routines.listUnscheduled()) {
    if (routine.kind === 'job' && !(routine.job_type && deps.jobs[routine.job_type])) {
      continue;
    }
    const { next, error } = nextRunFor(routine, now);
    await routines.schedule(routine.org_id, routine.id, { nextRunAt: next, error });
    if (next) agendadas += 1;
  }
  return agendadas;
}
