import { redact, type JsonValue, type QueueName, type TaskStatus } from '@givance/core';
import { assertOk, unwrap, unwrapMaybe, type TypedClient } from './client';
import type { Json, Tables } from './database.types';

/**
 * Repositórios usados pelo worker. Toda função recebe org_id e filtra por ele, mesmo quando o
 * id do registro já seria suficiente: com a chave secreta não há RLS para segurar um erro.
 */

export type TaskRow = Tables<'tasks'>;
export type EmployeeRow = Tables<'employees'>;
export type RoutineRow = Tables<'routines'>;
export type ApprovalRow = Tables<'approvals'>;

export interface QueueMessage {
  msgId: number;
  readCount: number;
  enqueuedAt: string;
  message: Record<string, unknown>;
}

export function queueRepo(db: TypedClient) {
  return {
    async read(
      queue: QueueName,
      visibilitySeconds: number,
      quantity: number,
    ): Promise<QueueMessage[]> {
      const rows = unwrapMaybe(
        `fila ${queue}: ler`,
        await db.rpc('queue_read', {
          p_queue: queue,
          p_visibility_seconds: visibilitySeconds,
          p_quantity: quantity,
        }),
      );
      return (rows ?? []).map((row) => ({
        msgId: row.msg_id,
        readCount: row.read_ct,
        enqueuedAt: row.enqueued_at,
        message: (row.message ?? {}) as Record<string, unknown>,
      }));
    },
    async archive(queue: QueueName, msgId: number): Promise<void> {
      assertOk(
        `fila ${queue}: arquivar`,
        await db.rpc('queue_archive', { p_queue: queue, p_msg_id: msgId }),
      );
    },
    async setVisibility(queue: QueueName, msgId: number, seconds: number): Promise<void> {
      assertOk(
        `fila ${queue}: visibilidade`,
        await db.rpc('queue_set_visibility', {
          p_queue: queue,
          p_msg_id: msgId,
          p_visibility_seconds: seconds,
        }),
      );
    },
    async send(
      queue: QueueName,
      message: Record<string, unknown>,
      delaySeconds = 0,
    ): Promise<number> {
      return unwrap(
        `fila ${queue}: enviar`,
        await db.rpc('queue_send', {
          p_queue: queue,
          p_message: message as Json,
          p_delay_seconds: delaySeconds,
        }),
      );
    },
  };
}

export interface ClaimedTask {
  taskId: string;
  orgId: string;
  runId: string;
  runNumber: number;
  runTrigger: 'inicio' | 'retomada' | 'reexecucao';
  attempts: number;
  maxAttempts: number;
}

export function tasksRepo(db: TypedClient) {
  return {
    async get(orgId: string, taskId: string): Promise<TaskRow | null> {
      return unwrapMaybe(
        'tarefa: ler',
        await db.from('tasks').select('*').eq('org_id', orgId).eq('id', taskId).maybeSingle(),
      );
    },
    /** Assume a tarefa (a_fazer -> em_andamento) e abre uma execução. Null se outro worker pegou. */
    async claim(orgId: string, taskId: string): Promise<ClaimedTask | null> {
      const rows = unwrapMaybe(
        'tarefa: assumir',
        await db.rpc('claim_task', { p_task_id: taskId }),
      );
      const row = rows?.[0];
      if (!row || row.org_id !== orgId) {
        return null;
      }
      return {
        taskId: row.task_id,
        orgId: row.org_id,
        runId: row.run_id,
        runNumber: row.run_number,
        runTrigger: row.run_trigger as ClaimedTask['runTrigger'],
        attempts: row.attempts,
        maxAttempts: row.max_attempts,
      };
    },
    async finish(
      orgId: string,
      taskId: string,
      update: { status: TaskStatus; result?: JsonValue; error?: string | null },
    ): Promise<void> {
      const terminal =
        update.status === 'concluida' ||
        update.status === 'falhou' ||
        update.status === 'cancelada';
      assertOk(
        'tarefa: finalizar',
        await db
          .from('tasks')
          .update({
            status: update.status,
            ...(update.result !== undefined ? { result: update.result as Json } : {}),
            error: update.error ?? null,
            ...(terminal ? { finished_at: new Date().toISOString() } : {}),
          })
          .eq('org_id', orgId)
          .eq('id', taskId),
      );
    },
    async requeue(
      orgId: string,
      taskId: string,
      delaySeconds: number,
      reason: string,
    ): Promise<boolean> {
      const task = await this.get(orgId, taskId);
      if (!task) return false;
      return unwrap(
        'tarefa: reenfileirar',
        await db.rpc('requeue_task', {
          p_task_id: taskId,
          p_delay_seconds: delaySeconds,
          p_reason: reason,
        }),
      );
    },
    /** Retoma a tarefa depois de uma ação executada, se nada mais estiver pendente. */
    async resumeIfIdle(orgId: string, taskId: string): Promise<boolean> {
      const pendentes = await db
        .from('approvals')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('task_id', taskId)
        .eq('status', 'pendente');
      assertOk('aprovações: contar pendentes', pendentes);
      if ((pendentes.count ?? 0) > 0) return false;
      const updated = unwrapMaybe(
        'tarefa: retomar',
        await db
          .from('tasks')
          .update({ status: 'a_fazer' })
          .eq('org_id', orgId)
          .eq('id', taskId)
          .eq('status', 'aguardando_aprovacao')
          .select('id'),
      );
      return (updated ?? []).length > 0;
    },
    async createFromRoutine(input: {
      orgId: string;
      employeeId: string;
      routineId: string;
      title: string;
      instructions: string;
      initialAgent?: string;
    }): Promise<string> {
      const row = unwrap(
        'tarefa: criar pela rotina',
        await db
          .from('tasks')
          .insert({
            org_id: input.orgId,
            employee_id: input.employeeId,
            routine_id: input.routineId,
            title: input.title.slice(0, 300),
            input: {
              instrucoes: input.instructions,
              ...(input.initialAgent ? { agente_inicial: input.initialAgent } : {}),
            },
            source: 'rotina',
          })
          .select('id')
          .single(),
      );
      return row.id;
    },
  };
}

export interface RunFinish {
  status: 'concluida' | 'pausada' | 'falhou' | 'cancelada';
  sessionId: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  usageByAgent: JsonValue;
  promptHashes: Record<string, string>;
  tainted: boolean;
  error?: string;
}

export function runsRepo(db: TypedClient) {
  return {
    async finish(orgId: string, runId: string, data: RunFinish): Promise<void> {
      assertOk(
        'execução: finalizar',
        await db
          .from('agent_runs')
          .update({
            status: data.status,
            session_id: data.sessionId,
            model: data.model,
            input_tokens: data.inputTokens,
            output_tokens: data.outputTokens,
            cache_read_tokens: data.cacheReadTokens,
            cache_write_tokens: data.cacheWriteTokens,
            cost_usd: Number(data.costUsd.toFixed(6)),
            usage_by_agent: data.usageByAgent as NonNullable<Json>,
            prompt_hashes: data.promptHashes,
            tainted: data.tainted,
            error: data.error?.slice(0, 4000) ?? null,
            ended_at: new Date().toISOString(),
          })
          .eq('org_id', orgId)
          .eq('id', runId),
      );
      assertOk('consumo: registrar', await db.rpc('record_run_usage', { p_run_id: runId }));
    },
    async addStep(
      orgId: string,
      runId: string,
      step: {
        agent: string;
        kind: 'tool_call' | 'delegacao' | 'mensagem' | 'erro';
        toolName?: string;
        toolUseId?: string;
        status?: 'ok' | 'erro' | 'negado';
        input?: unknown;
        output?: unknown;
        durationMs?: number;
      },
    ): Promise<void> {
      assertOk(
        'passo: gravar',
        await db.from('agent_steps').insert({
          org_id: orgId,
          run_id: runId,
          agent: step.agent.slice(0, 80),
          kind: step.kind,
          tool_name: step.toolName?.slice(0, 200) ?? null,
          tool_use_id: step.toolUseId?.slice(0, 200) ?? null,
          status: step.status ?? null,
          input_redacted: step.input === undefined ? null : (redact(step.input) as Json),
          output_redacted: step.output === undefined ? null : (redact(step.output) as Json),
          duration_ms:
            step.durationMs === undefined ? null : Math.max(0, Math.round(step.durationMs)),
        }),
      );
    },
    async list(orgId: string, taskId: string) {
      return unwrapMaybe(
        'execuções: listar',
        await db
          .from('agent_runs')
          .select('id, run_number, trigger, status, error, started_at, ended_at')
          .eq('org_id', orgId)
          .eq('task_id', taskId)
          .order('run_number'),
      );
    },
  };
}

export interface EmployeeContext {
  employee: EmployeeRow;
  roleKey: string;
  roleVersion: number;
  roleConfig: unknown;
}

export function employeesRepo(db: TypedClient) {
  return {
    async getWithRole(orgId: string, employeeId: string): Promise<EmployeeContext | null> {
      const row = unwrapMaybe(
        'funcionário: ler',
        await db
          .from('employees')
          .select('*, role_versions!inner(role_key, version, config)')
          .eq('org_id', orgId)
          .eq('id', employeeId)
          .maybeSingle(),
      );
      if (!row) return null;
      const { role_versions: roleVersion, ...employee } = row;
      return {
        employee,
        roleKey: roleVersion.role_key,
        roleVersion: roleVersion.version,
        roleConfig: roleVersion.config,
      };
    },
  };
}

export interface CompanySnapshot {
  org: Tables<'organizations'>;
  profile: Tables<'company_profiles'> | null;
  products: Array<
    Pick<Tables<'products'>, 'name' | 'description' | 'price_cents' | 'price_is_public'>
  >;
}

export function companyRepo(db: TypedClient) {
  return {
    async snapshot(orgId: string): Promise<CompanySnapshot | null> {
      const org = unwrapMaybe(
        'empresa: ler',
        await db.from('organizations').select('*').eq('id', orgId).maybeSingle(),
      );
      if (!org) return null;
      const profile = unwrapMaybe(
        'perfil: ler',
        await db.from('company_profiles').select('*').eq('org_id', orgId).maybeSingle(),
      );
      const products = unwrapMaybe(
        'produtos: listar',
        await db
          .from('products')
          .select('name, description, price_cents, price_is_public')
          .eq('org_id', orgId)
          .eq('active', true)
          .order('name'),
      );
      return { org, profile, products: products ?? [] };
    },
    /** Custo acumulado no mês corrente (USD). */
    async monthCostUsd(orgId: string, now = new Date()): Promise<number> {
      const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
      const rows = unwrapMaybe(
        'consumo: somar mês',
        await db.from('usage_ledger').select('cost_usd').eq('org_id', orgId).eq('period', period),
      );
      return (rows ?? []).reduce((sum, row) => sum + Number(row.cost_usd), 0);
    },
  };
}

export function routinesRepo(db: TypedClient) {
  return {
    async get(orgId: string, routineId: string): Promise<RoutineRow | null> {
      return unwrapMaybe(
        'rotina: ler',
        await db.from('routines').select('*').eq('org_id', orgId).eq('id', routineId).maybeSingle(),
      );
    },
    /** Libera a rotina com o próximo horário (ou com erro, se o cron for inválido). */
    async schedule(
      orgId: string,
      routineId: string,
      update: { nextRunAt: Date | null; ranAt?: Date; error?: string | null },
    ): Promise<void> {
      assertOk(
        'rotina: agendar',
        await db
          .from('routines')
          .update({
            next_run_at: update.nextRunAt?.toISOString() ?? null,
            in_flight: false,
            ...(update.ranAt ? { last_run_at: update.ranAt.toISOString() } : {}),
            last_error: update.error ?? null,
          })
          .eq('org_id', orgId)
          .eq('id', routineId),
      );
    },
    /** Rotinas ativas que ainda não têm próximo horário calculado (todas as empresas). */
    async listUnscheduled(limit = 200): Promise<RoutineRow[]> {
      return (
        unwrapMaybe(
          'rotinas: sem agenda',
          await db
            .from('routines')
            .select('*')
            .eq('enabled', true)
            .eq('in_flight', false)
            .is('next_run_at', null)
            .is('last_error', null)
            .limit(limit),
        ) ?? []
      );
    },
  };
}

function resumoJson(value: unknown, max = 400): string {
  const texto = JSON.stringify(redact(value));
  return texto.length > max ? `${texto.slice(0, max)}…` : texto;
}

/** Histórico de uma tarefa em texto, para retomadas: execuções, aprovações e resultados. */
export async function taskHistory(
  db: TypedClient,
  orgId: string,
  taskId: string,
): Promise<string | undefined> {
  const runs = unwrapMaybe(
    'histórico: execuções',
    await db
      .from('agent_runs')
      .select('run_number, trigger, status, error, ended_at')
      .eq('org_id', orgId)
      .eq('task_id', taskId)
      .neq('status', 'em_andamento')
      .order('run_number'),
  );
  const approvals = unwrapMaybe(
    'histórico: aprovações',
    await db
      .from('approvals')
      .select(
        'id, action_type, status, decision_note, payload, edited_payload, created_at, action_executions(status, error, result_redacted, attempt)',
      )
      .eq('org_id', orgId)
      .eq('task_id', taskId)
      .order('created_at'),
  );
  if ((runs ?? []).length === 0 && (approvals ?? []).length === 0) {
    return undefined;
  }

  const linhas: string[] = [];
  for (const run of runs ?? []) {
    linhas.push(
      `- Execução ${run.run_number} (${run.trigger}): ${run.status}${run.error ? ` — ${run.error}` : ''}`,
    );
  }
  for (const approval of approvals ?? []) {
    let linha = `- Ação ${approval.action_type} (aprovação ${approval.id}): ${approval.status}`;
    if (approval.decision_note) linha += `; observação do dono: "${approval.decision_note}"`;
    if (approval.edited_payload)
      linha += `; o dono editou os dados para ${resumoJson(approval.edited_payload)}`;
    const execucoes = approval.action_executions ?? [];
    const ultima = [...execucoes].sort((a, b) => b.attempt - a.attempt)[0];
    if (ultima) {
      linha += `; execução: ${ultima.status}`;
      if (ultima.status === 'sucesso' && ultima.result_redacted)
        linha += ` — ${resumoJson(ultima.result_redacted, 300)}`;
      if (ultima.status === 'falhou' && ultima.error) linha += ` — ${ultima.error}`;
    }
    linhas.push(linha);
  }
  return linhas.join('\n');
}
