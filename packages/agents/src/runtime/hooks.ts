import type {
  HookCallbackMatcher,
  HookEvent,
  HookInput,
  HookJSONOutput,
} from '@anthropic-ai/claude-agent-sdk';
import { ORCHESTRATOR } from './usage';

/** Recebe os eventos de cada execução para gravar o rastro (agent_steps) e a auditoria. */
export interface StepRecorder {
  toolStarted(event: { toolUseId: string; agent: string; toolName: string; input: unknown }): void;
  toolFinished(event: {
    toolUseId: string;
    agent: string;
    toolName: string;
    output: unknown;
    durationMs?: number;
    status: 'ok' | 'erro';
  }): void;
  toolDenied(event: { toolUseId: string; agent: string; toolName: string; reason: string }): void;
  delegated(event: {
    agent: string;
    agentId: string;
    phase: 'inicio' | 'fim';
    summary?: string;
  }): void;
}

export const noopRecorder: StepRecorder = {
  toolStarted() {},
  toolFinished() {},
  toolDenied() {},
  delegated() {},
};

/**
 * Liga cada chamada de ferramenta ao agente que a fez. O hook PreToolUse sabe quem chamou
 * (agent_type); o handler da ferramenta MCP não sabe. A atribuição usa o id da chamada quando
 * o SDK o repassa ao handler e, na falta dele, a ordem de chegada por nome de ferramenta.
 */
export class AgentAttribution {
  private readonly byToolUseId = new Map<string, string>();
  private readonly pendingByTool = new Map<string, string[]>();

  record(toolName: string, toolUseId: string, agent: string): void {
    this.byToolUseId.set(toolUseId, agent);
    const fila = this.pendingByTool.get(toolName) ?? [];
    fila.push(agent);
    this.pendingByTool.set(toolName, fila);
  }

  /** Agente que fez a chamada em andamento de `toolName` (nome completo mcp__...). */
  take(toolName: string, extra: unknown): string {
    const meta = (extra as { _meta?: Record<string, unknown> } | undefined)?._meta;
    const toolUseId =
      typeof meta?.['claudecode/toolUseId'] === 'string' ? meta['claudecode/toolUseId'] : null;
    const fila = this.pendingByTool.get(toolName);
    if (toolUseId && this.byToolUseId.has(toolUseId)) {
      const agent = this.byToolUseId.get(toolUseId) ?? ORCHESTRATOR;
      const index = fila?.indexOf(agent) ?? -1;
      if (fila && index >= 0) fila.splice(index, 1);
      return agent;
    }
    return fila?.shift() ?? ORCHESTRATOR;
  }
}

export interface RuntimeHooksInput {
  /** Especialistas que o orquestrador pode chamar pela ferramenta Agent. */
  allowedSubagents: ReadonlySet<string>;
  /** Ferramentas MCP (nome completo) permitidas para cada agente. */
  toolsByAgent: ReadonlyMap<string, ReadonlySet<string>>;
  attribution: AgentAttribution;
  recorder: StepRecorder;
}

const DELEGATION_TOOLS = new Set(['Agent', 'Task']);

function deny(reason: string): HookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
}

function agentOf(input: HookInput): string {
  return input.agent_id && input.agent_type ? input.agent_type : ORCHESTRATOR;
}

/**
 * Hooks que aplicam, em código, os limites de cada agente:
 * - só o orquestrador delega, só para os especialistas do cargo, sempre em primeiro plano;
 * - cada agente só usa as ferramentas declaradas para ele;
 * - qualquer outra ferramenta é negada.
 * E registram cada chamada para o rastro da execução.
 */
export function createRuntimeHooks(
  input: RuntimeHooksInput,
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const startedAt = new Map<string, number>();

  const preToolUse = async (hookInput: HookInput): Promise<HookJSONOutput> => {
    if (hookInput.hook_event_name !== 'PreToolUse') return {};
    const agent = agentOf(hookInput);
    const { tool_name: toolName, tool_use_id: toolUseId } = hookInput;

    const negar = (reason: string) => {
      input.recorder.toolDenied({ toolUseId, agent, toolName, reason });
      return deny(reason);
    };

    if (DELEGATION_TOOLS.has(toolName)) {
      if (agent !== ORCHESTRATOR) {
        return negar(
          'Especialistas não delegam trabalho. Entregue o resultado com salvar_artefato.',
        );
      }
      const params = (hookInput.tool_input ?? {}) as Record<string, unknown>;
      const subagent = typeof params.subagent_type === 'string' ? params.subagent_type : '';
      if (!input.allowedSubagents.has(subagent)) {
        const opcoes = [...input.allowedSubagents].join(', ');
        return negar(
          `Especialista "${subagent || '(vazio)'}" não faz parte deste cargo. Opções: ${opcoes}.`,
        );
      }
      input.recorder.toolStarted({
        toolUseId,
        agent,
        toolName,
        input: { subagent_type: subagent },
      });
      startedAt.set(toolUseId, Date.now());
      // Primeiro plano sempre: o orquestrador precisa do resultado para seguir. Campos como
      // modelo, isolamento e nome são decididos pelo cargo, não pela chamada.
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          updatedInput: {
            subagent_type: subagent,
            description: typeof params.description === 'string' ? params.description : subagent,
            prompt: typeof params.prompt === 'string' ? params.prompt : '',
            run_in_background: false,
          },
        },
      };
    }

    const permitidas = input.toolsByAgent.get(agent);
    if (!permitidas?.has(toolName)) {
      return negar(`A ferramenta ${toolName} não está disponível para ${agent}.`);
    }
    input.attribution.record(toolName, toolUseId, agent);
    input.recorder.toolStarted({ toolUseId, agent, toolName, input: hookInput.tool_input });
    startedAt.set(toolUseId, Date.now());
    return {};
  };

  const postToolUse = async (hookInput: HookInput): Promise<HookJSONOutput> => {
    if (hookInput.hook_event_name === 'PostToolUse') {
      const inicio = startedAt.get(hookInput.tool_use_id);
      startedAt.delete(hookInput.tool_use_id);
      input.recorder.toolFinished({
        toolUseId: hookInput.tool_use_id,
        agent: agentOf(hookInput),
        toolName: hookInput.tool_name,
        output: hookInput.tool_response,
        durationMs: hookInput.duration_ms ?? (inicio ? Date.now() - inicio : undefined),
        status: 'ok',
      });
    } else if (hookInput.hook_event_name === 'PostToolUseFailure') {
      startedAt.delete(hookInput.tool_use_id);
      input.recorder.toolFinished({
        toolUseId: hookInput.tool_use_id,
        agent: agentOf(hookInput),
        toolName: hookInput.tool_name,
        output: { erro: hookInput.error },
        status: 'erro',
      });
    }
    return {};
  };

  const subagentLifecycle = async (hookInput: HookInput): Promise<HookJSONOutput> => {
    if (hookInput.hook_event_name === 'SubagentStart') {
      input.recorder.delegated({
        agent: hookInput.agent_type,
        agentId: hookInput.agent_id,
        phase: 'inicio',
      });
    } else if (hookInput.hook_event_name === 'SubagentStop') {
      input.recorder.delegated({
        agent: hookInput.agent_type,
        agentId: hookInput.agent_id,
        phase: 'fim',
        summary: hookInput.last_assistant_message,
      });
    }
    return {};
  };

  return {
    // Uma falha do hook de permissão bloqueia a chamada: na dúvida, não executa.
    PreToolUse: [{ hooks: [preToolUse], onFailure: 'block' }],
    PostToolUse: [{ hooks: [postToolUse] }],
    PostToolUseFailure: [{ hooks: [postToolUse] }],
    SubagentStart: [{ hooks: [subagentLifecycle] }],
    SubagentStop: [{ hooks: [subagentLifecycle] }],
  };
}
