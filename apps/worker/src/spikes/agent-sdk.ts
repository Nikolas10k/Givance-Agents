/**
 * Spike do Agent SDK com o runtime real da Givance, sem banco (serviços em memória).
 *
 * Uso (custo estimado: alguns centavos de dólar):
 *   ANTHROPIC_API_KEY=... pnpm --filter @givance/worker spike:agent-sdk
 *   SPIKE_MODEL=claude-sonnet-5-5   -> troca o modelo de todos os agentes (opcional)
 *   SPIKE_DEBUG=1                   -> mostra o stderr do Claude Code
 *
 * O que observar no relatório: se o orquestrador delegou ao copywriter, se o especialista
 * usou as próprias ferramentas, se a ação virou aprovação pendente, e o custo por agente.
 */
import { randomUUID } from 'node:crypto';
import {
  buildCompanyContext,
  loadPrompt,
  loadRoleFiles,
  resolveContentRoot,
  resolveRole,
  runAgentTask,
  type StepRecorder,
} from '@givance/agents';
import { MODEL_IDS, type ResolvedRole } from '@givance/core';
import { createDefaultRegistry, createRunState } from '@givance/tools';
import { createMemoryServices } from '@givance/tools/testing';

function trocarModelo(role: ResolvedRole, modelo: string | undefined): ResolvedRole {
  if (!modelo) return role;
  if (!(MODEL_IDS as readonly string[]).includes(modelo)) {
    throw new Error(`SPIKE_MODEL inválido. Use um de: ${MODEL_IDS.join(', ')}`);
  }
  const m = modelo as ResolvedRole['orquestrador']['modelo'];
  return {
    ...role,
    orquestrador: { ...role.orquestrador, modelo: m },
    especialistas: Object.fromEntries(
      Object.entries(role.especialistas).map(([k, s]) => [k, { ...s, modelo: m }]),
    ),
  };
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('Defina ANTHROPIC_API_KEY para rodar o spike (veja docs/spikes/agent-sdk.md).');
    process.exit(1);
  }

  const root = resolveContentRoot();
  const resolvido = resolveRole('braco-direito', await loadRoleFiles(root));
  if (!resolvido.role) throw new Error(resolvido.problems.join('\n'));
  const role = trocarModelo(resolvido.role, process.env.SPIKE_MODEL);

  const prompts = {
    orchestrator: await loadPrompt(root, role.orquestrador.prompt),
    specialists: Object.fromEntries(
      await Promise.all(
        Object.entries(role.especialistas).map(
          async ([k, s]) => [k, await loadPrompt(root, s.prompt)] as const,
        ),
      ),
    ),
  };

  const orgId = randomUUID();
  const memory = createMemoryServices();
  await memory.services.knowledge.addDocument({
    orgId,
    title: 'Regras de comunicação',
    source: 'manual',
    chunks: [
      'Não divulgamos o preço do clareamento em posts. A limpeza custa R$ 180,00 e a avaliação inicial é gratuita.',
    ],
  });

  const eventos: Array<Record<string, unknown>> = [];
  const recorder: StepRecorder = {
    toolStarted: (e) => eventos.push({ evento: 'inicio', agente: e.agent, ferramenta: e.toolName }),
    toolFinished: (e) =>
      eventos.push({
        evento: 'fim',
        agente: e.agent,
        ferramenta: e.toolName,
        status: e.status,
        ms: e.durationMs,
      }),
    toolDenied: (e) =>
      eventos.push({ evento: 'negado', agente: e.agent, ferramenta: e.toolName, motivo: e.reason }),
    delegated: (e) => eventos.push({ evento: `subagente_${e.phase}`, agente: e.agent }),
  };

  const inicio = Date.now();
  const outcome = await runAgentTask({
    role,
    prompts,
    companyContext: buildCompanyContext({
      funcionario: 'Lia',
      empresa: 'Clínica Exemplo',
      segmento: 'Odontologia',
      tomDeVoz: 'Acolhedor e claro. Trata o paciente por você.',
      setorRegulado: 'saude',
      naoDizer: ['resultado garantido', 'sem dor', 'antes e depois'],
      fuso: 'America/Sao_Paulo',
    }),
    brief: {
      title: 'Spike: legenda e regra de comunicação',
      source: 'painel',
      request:
        'Peça ao copywriter uma legenda curta (até 300 caracteres) para um post sobre a limpeza dental. ' +
        'Depois peça para registrar na memória da empresa que as legendas terminam com "Agende pelo WhatsApp". ' +
        'Por fim, me avise do que foi feito.',
      thirdPartyContent: false,
      timezone: 'America/Sao_Paulo',
    },
    task: {
      orgId,
      taskId: randomUUID(),
      employeeId: randomUUID(),
      runId: null,
      taskSource: 'painel',
    },
    run: createRunState(),
    registry: createDefaultRegistry(),
    services: memory.services,
    apiKey,
    recorder,
    stderr: (data) => {
      if (process.env.SPIKE_DEBUG) process.stderr.write(data);
    },
  });

  const relatorio = {
    duracao_s: Math.round((Date.now() - inicio) / 100) / 10,
    status: outcome.status,
    resultado_sdk: outcome.resultSubtype,
    erro: outcome.error ?? null,
    sessao: outcome.sessionId,
    custo_total_usd: outcome.usage.costUsd,
    tokens_total: outcome.usage.total,
    por_agente: outcome.usage.byAgent,
    eventos,
    artefatos: memory.state.artifacts.map((a) => ({
      tipo: a.kind,
      por: a.createdByAgent,
      dados: a.data,
    })),
    aprovacoes: memory.state.approvals.map((a) => ({
      tipo: a.actionType,
      status: a.status,
      nivel: a.autonomyLevel,
      pedida_por: a.requestedByAgent,
      payload: a.payload,
    })),
    mensagens_ao_dono: memory.state.messages.map((m) => m.content),
    texto_final: outcome.finalText,
  };
  console.log(JSON.stringify(relatorio, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
