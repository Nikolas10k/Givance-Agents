import {
  buildCompanyContext,
  loadPrompt,
  rolePromptPaths,
  runAgentTask,
  type AgentRunOutcome,
  type LoadedPrompt,
} from '@givance/agents';
import { errorMessage, resolvedRoleSchema, type JsonValue, type ResolvedRole } from '@givance/core';
import {
  companyRepo,
  employeesRepo,
  runsRepo,
  taskHistory,
  tasksRepo,
  type QueueMessage,
  type TaskRow,
} from '@givance/db';
import { createRunState } from '@givance/tools';
import type { WorkerDeps } from '../deps';
import { parseMessage, taskRunMessage } from '../messages';
import { createStepRecorder } from '../recorder';

/** Espera antes de tentar de novo uma tarefa que falhou (segundos), por tentativa. */
const RETRY_DELAYS = [60, 300, 900];

async function loadRolePrompts(contentRoot: string, role: ResolvedRole) {
  const cache = new Map<string, LoadedPrompt>();
  const load = async (path: string) => {
    const cached = cache.get(path);
    if (cached) return cached;
    const prompt = await loadPrompt(contentRoot, path);
    cache.set(path, prompt);
    return prompt;
  };
  await Promise.all(rolePromptPaths(role).map(load));
  const specialists: Record<string, LoadedPrompt> = {};
  for (const [key, specialist] of Object.entries(role.especialistas)) {
    specialists[key] = await load(specialist.prompt);
  }
  return { orchestrator: await load(role.orquestrador.prompt), specialists };
}

/** Pedido em texto e dados extras a partir do input da tarefa. */
function splitInput(task: TaskRow): { request: string; data: Record<string, unknown> } {
  const input = (task.input ?? {}) as Record<string, unknown>;
  const { mensagem, instrucoes, agente_inicial, ...data } = input;
  let request =
    (typeof mensagem === 'string' && mensagem) ||
    (typeof instrucoes === 'string' && instrucoes) ||
    task.title;
  if (typeof agente_inicial === 'string' && agente_inicial) {
    request += `\n\nComece delegando ao especialista "${agente_inicial}".`;
  }
  return { request, data };
}

function usageByAgent(outcome: AgentRunOutcome): JsonValue {
  const result: Record<string, JsonValue> = {};
  for (const [agent, usage] of Object.entries(outcome.usage.byAgent)) {
    result[agent] = {
      modelo: usage.model,
      tokens_entrada: usage.usage.inputTokens,
      tokens_saida: usage.usage.outputTokens,
      tokens_cache_leitura: usage.usage.cacheReadTokens,
      tokens_cache_escrita: usage.usage.cacheWriteTokens,
      custo_usd: Number(usage.costUsd.toFixed(6)),
    };
  }
  return result;
}

export function createTaskRunHandler(deps: WorkerDeps) {
  const { db, services, logger } = deps;
  const tasks = tasksRepo(db);
  const runs = runsRepo(db);

  /** Falha definitiva: grava o motivo e avisa o dono na conversa da tarefa. */
  const failTask = async (orgId: string, taskId: string, motivo: string, avisoAoDono?: string) => {
    await tasks.finish(orgId, taskId, { status: 'falhou', error: motivo });
    await services.audit.log({
      orgId,
      actorType: 'sistema',
      actorId: 'worker',
      action: 'tarefa.falhou',
      target: `task:${taskId}`,
      reason: motivo,
      taskId,
    });
    if (avisoAoDono) {
      await services.messages.sendToOwner(orgId, taskId, avisoAoDono).catch(() => undefined);
    }
  };

  return async function handleTaskRun(message: QueueMessage, signal: AbortSignal): Promise<void> {
    const body = parseMessage(taskRunMessage, message.message);
    const orgId = body.org_id;
    const taskId = body.task_id;
    const log = logger.child({ orgId, taskId });

    const task = await tasks.get(orgId, taskId);
    if (!task) {
      log.warn('Tarefa não encontrada; mensagem ignorada');
      return;
    }

    if (task.status === 'em_andamento' && message.readCount > 1) {
      // A mensagem voltou para a fila sem ser arquivada: o worker anterior caiu no meio.
      await recoverInterruptedRun(deps, orgId, task);
      return;
    }
    if (task.status !== 'a_fazer') {
      log.debug('Tarefa não está em "a_fazer"; mensagem antiga ignorada', { status: task.status });
      return;
    }

    const employee = await employeesRepo(db).getWithRole(orgId, task.employee_id);
    const company = await companyRepo(db).snapshot(orgId);
    if (!employee || !company) {
      await failTask(orgId, taskId, 'Funcionário ou empresa não encontrados.');
      return;
    }
    if (employee.employee.status === 'pausado') {
      log.info('Funcionário pausado; tarefa fica aguardando');
      return;
    }
    if (company.org.status !== 'ativa') {
      await failTask(orgId, taskId, `Empresa com status "${company.org.status}".`);
      return;
    }

    const roleParsed = resolvedRoleSchema.safeParse(employee.roleConfig);
    if (!roleParsed.success) {
      await failTask(
        orgId,
        taskId,
        `Configuração do cargo ${employee.roleKey} v${employee.roleVersion} inválida.`,
      );
      return;
    }
    const role = roleParsed.data;

    const teto = company.org.monthly_cost_cap_usd;
    if (teto !== null && (await companyRepo(db).monthCostUsd(orgId)) >= Number(teto)) {
      await failTask(
        orgId,
        taskId,
        'Teto mensal de custo atingido.',
        'Não comecei esta tarefa porque o teto de custo do mês foi atingido. Você pode ajustar o teto no painel.',
      );
      return;
    }

    if (!deps.apiKey) {
      await failTask(
        orgId,
        taskId,
        'ANTHROPIC_API_KEY não configurada no worker.',
        'Ainda não consigo trabalhar: a chave da API de IA não foi configurada no servidor.',
      );
      return;
    }

    const claimed = await tasks.claim(orgId, taskId);
    if (!claimed) {
      log.debug('Outro worker assumiu a tarefa');
      return;
    }

    const prompts = await loadRolePrompts(deps.contentRoot, role);
    const { request, data } = splitInput(task);
    const history = claimed.runNumber > 1 ? await taskHistory(db, orgId, taskId) : undefined;
    const profile = company.profile;
    const companyContext = buildCompanyContext({
      funcionario: employee.employee.display_name,
      empresa: company.org.name,
      segmento: profile?.segment,
      descricao: profile?.description,
      tomDeVoz: profile?.tone_of_voice,
      regioes: profile?.regions ?? [],
      naoDizer: profile?.do_not_say ?? [],
      setorRegulado: profile?.regulated_sector,
      horarioAtendimento: profile?.business_hours,
      site: profile?.website_url,
      instagram: profile?.instagram_handle,
      fuso: company.org.timezone,
      produtos: company.products.map((p) => ({
        nome: p.name,
        descricao: p.description,
        precoCentavos: p.price_cents,
        precoPublico: p.price_is_public,
      })),
    });

    const recorder = createStepRecorder(db, orgId, claimed.runId, log);
    const run = createRunState(task.tainted);
    let outcome: AgentRunOutcome;
    try {
      outcome = await runAgentTask({
        role,
        prompts,
        companyContext,
        brief: {
          title: task.title,
          source: task.source as never,
          request,
          data,
          thirdPartyContent: task.tainted,
          ...(history ? { history } : {}),
          timezone: company.org.timezone,
          ...(deps.now ? { now: deps.now() } : {}),
        },
        task: {
          orgId,
          taskId,
          employeeId: task.employee_id,
          runId: claimed.runId,
          taskSource: task.source as never,
        },
        run,
        registry: deps.registry,
        services,
        apiKey: deps.apiKey,
        recorder,
        signal,
        ...(deps.queryFn ? { queryFn: deps.queryFn } : {}),
        onToolError: (tool, error) =>
          log.error('Erro interno em ferramenta', { tool, erro: errorMessage(error) }),
        stderr: (data) => log.debug('agent-sdk', { stderr: data.slice(0, 500) }),
      });
    } finally {
      await recorder.flush();
    }

    const pendentes = await services.approvals.countPendingForTask(orgId, taskId);
    const runStatus =
      outcome.status === 'concluida'
        ? pendentes > 0
          ? 'pausada'
          : 'concluida'
        : outcome.status === 'cancelada'
          ? 'cancelada'
          : 'falhou';

    await runs.finish(orgId, claimed.runId, {
      status: runStatus,
      sessionId: outcome.sessionId,
      model: role.orquestrador.modelo,
      inputTokens: outcome.usage.total.inputTokens,
      outputTokens: outcome.usage.total.outputTokens,
      cacheReadTokens: outcome.usage.total.cacheReadTokens,
      cacheWriteTokens: outcome.usage.total.cacheWriteTokens,
      costUsd: outcome.usage.costUsd,
      usageByAgent: usageByAgent(outcome),
      promptHashes: outcome.promptHashes,
      tainted: outcome.tainted,
      ...(outcome.error ? { error: outcome.error } : {}),
    });

    await services.audit.log({
      orgId,
      actorType: 'sistema',
      actorId: 'worker',
      action: 'execucao.finalizada',
      target: `run:${claimed.runId}`,
      taskId,
      runId: claimed.runId,
      tokens:
        outcome.usage.total.inputTokens +
        outcome.usage.total.outputTokens +
        outcome.usage.total.cacheReadTokens +
        outcome.usage.total.cacheWriteTokens,
      costUsd: Number(outcome.usage.costUsd.toFixed(6)),
      payload: {
        status: runStatus,
        resultado_sdk: outcome.resultSubtype,
        por_agente: usageByAgent(outcome),
      },
    });

    switch (outcome.status) {
      case 'concluida':
        await tasks.finish(orgId, taskId, {
          status: pendentes > 0 ? 'aguardando_aprovacao' : 'concluida',
          result: { resumo: outcome.finalText ?? null },
        });
        log.info('Execução concluída', { pendentes, custo: outcome.usage.costUsd });
        return;
      case 'cancelada':
        await tasks.requeue(orgId, taskId, 30, 'Execução interrompida (worker reiniciando).');
        log.info('Execução cancelada; tarefa devolvida à fila');
        return;
      case 'limite':
        await failTask(
          orgId,
          taskId,
          outcome.error ?? 'Limite da tarefa atingido.',
          `Parei esta tarefa porque atingi o limite definido para ela (${outcome.error ?? 'limite'}). ` +
            'Se quiser, divida o pedido em partes menores.',
        );
        return;
      case 'falhou': {
        if (claimed.attempts < claimed.maxAttempts) {
          const espera =
            RETRY_DELAYS[Math.min(claimed.attempts - 1, RETRY_DELAYS.length - 1)] ?? 900;
          await tasks.requeue(orgId, taskId, espera, outcome.error ?? 'Falha na execução.');
          log.warn('Execução falhou; nova tentativa agendada', { erro: outcome.error, espera });
          return;
        }
        await failTask(
          orgId,
          taskId,
          outcome.error ?? 'Falha na execução.',
          'Não consegui concluir esta tarefa depois de algumas tentativas. A equipe da Givance foi avisada pelo registro de falhas.',
        );
        return;
      }
    }
  };
}

/** Marca como falha a execução que ficou pela metade e devolve a tarefa à fila. */
async function recoverInterruptedRun(
  deps: WorkerDeps,
  orgId: string,
  task: TaskRow,
): Promise<void> {
  const runs = await runsRepo(deps.db).list(orgId, task.id);
  for (const run of runs ?? []) {
    if (run.status === 'em_andamento') {
      await runsRepo(deps.db).finish(orgId, run.id, {
        status: 'falhou',
        sessionId: null,
        model: '',
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
        usageByAgent: {},
        promptHashes: {},
        tainted: task.tainted,
        error: 'Execução interrompida: o worker parou no meio.',
      });
    }
  }
  if (task.attempts < task.max_attempts) {
    await tasksRepo(deps.db).requeue(
      orgId,
      task.id,
      30,
      'Execução interrompida: o worker parou no meio.',
    );
  } else {
    await tasksRepo(deps.db).finish(orgId, task.id, {
      status: 'falhou',
      error: 'Execução interrompida repetidas vezes.',
    });
  }
  deps.logger.warn('Execução interrompida recuperada', { orgId, taskId: task.id });
}
