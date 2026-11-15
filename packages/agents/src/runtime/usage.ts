import {
  addUsage,
  EMPTY_USAGE,
  estimateCostUsd,
  totalTokens,
  type TokenUsage,
} from '@givance/core';

export const ORCHESTRATOR = 'orquestrador';

/** Nome da ferramenta de delegação no SDK (o nome antigo era "Task"). */
const DELEGATION_TOOLS = new Set(['Agent', 'Task']);

export interface AgentUsage {
  model: string;
  usage: TokenUsage;
  costUsd: number;
}

export interface UsageSummary {
  total: TokenUsage;
  costUsd: number;
  byAgent: Record<string, AgentUsage>;
}

interface RawUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

function toUsage(raw: RawUsage | undefined): TokenUsage {
  return {
    inputTokens: raw?.input_tokens ?? 0,
    outputTokens: raw?.output_tokens ?? 0,
    cacheReadTokens: raw?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: raw?.cache_creation_input_tokens ?? 0,
  };
}

function maxUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: Math.max(a.inputTokens, b.inputTokens),
    outputTokens: Math.max(a.outputTokens, b.outputTokens),
    cacheReadTokens: Math.max(a.cacheReadTokens, b.cacheReadTokens),
    cacheWriteTokens: Math.max(a.cacheWriteTokens, b.cacheWriteTokens),
  };
}

/** Formato mínimo das mensagens do SDK que este rastreador lê. */
export interface ObservedMessage {
  type: string;
  subtype?: string;
  parent_tool_use_id?: string | null;
  message?: {
    id?: string;
    model?: string;
    usage?: RawUsage;
    content?: Array<{ type: string; id?: string; name?: string; input?: unknown }>;
  };
  total_cost_usd?: number;
  modelUsage?: Record<
    string,
    {
      inputTokens: number;
      outputTokens: number;
      cacheReadInputTokens: number;
      cacheCreationInputTokens: number;
      costUSD: number;
    }
  >;
}

/**
 * Divide o consumo de uma execução entre o orquestrador e cada especialista.
 *
 * O SDK informa o total oficial (total_cost_usd e modelUsage, que incluem os subagentes),
 * mas não por agente. Aqui cada resposta do modelo é atribuída a quem a produziu: as do
 * fluxo principal ao orquestrador, as de um subagente ao tipo de especialista da chamada
 * Agent que o criou (parent_tool_use_id). A divisão do custo usa a tabela de preços como peso
 * e é ajustada para somar exatamente o total oficial.
 */
export class UsageTracker {
  private readonly agentByDelegation = new Map<string, string>();
  private readonly responses = new Map<
    string,
    { agent: string; model: string; usage: TokenUsage }
  >();
  private anonymous = 0;
  private result: ObservedMessage | undefined;

  constructor(private readonly defaultModel: string) {}

  observe(message: ObservedMessage): void {
    if (message.type === 'result') {
      this.result = message;
      return;
    }
    if (message.type !== 'assistant' || !message.message) {
      return;
    }
    const parent = message.parent_tool_use_id ?? null;
    const agent = parent ? (this.agentByDelegation.get(parent) ?? 'subagente') : ORCHESTRATOR;

    for (const block of message.message.content ?? []) {
      if (block.type === 'tool_use' && block.id && block.name && DELEGATION_TOOLS.has(block.name)) {
        const input = (block.input ?? {}) as { subagent_type?: unknown };
        const tipo = typeof input.subagent_type === 'string' ? input.subagent_type : 'subagente';
        this.agentByDelegation.set(block.id, tipo);
      }
    }

    const usage = toUsage(message.message.usage);
    if (totalTokens(usage) === 0) {
      return;
    }
    // Uma resposta pode chegar em vários quadros com o mesmo id; o consumo informado é o
    // acumulado da resposta, então fica o maior valor visto.
    const id = message.message.id ?? `sem-id-${this.anonymous++}`;
    const previous = this.responses.get(id);
    this.responses.set(id, {
      agent,
      model: message.message.model ?? this.defaultModel,
      usage: previous ? maxUsage(previous.usage, usage) : usage,
    });
  }

  /** Delegações vistas: id da chamada Agent -> tipo do especialista. */
  delegations(): ReadonlyMap<string, string> {
    return this.agentByDelegation;
  }

  summary(): UsageSummary {
    const byAgent: Record<string, AgentUsage> = {};
    for (const response of this.responses.values()) {
      const current = byAgent[response.agent] ?? {
        model: response.model,
        usage: EMPTY_USAGE,
        costUsd: 0,
      };
      current.usage = addUsage(current.usage, response.usage);
      current.costUsd += estimateCostUsd(response.model, response.usage);
      byAgent[response.agent] = current;
    }

    const estimated = Object.values(byAgent).reduce((sum, a) => sum + a.costUsd, 0);
    const official = this.result?.total_cost_usd;
    if (typeof official === 'number' && official > 0 && estimated > 0) {
      const factor = official / estimated;
      for (const agent of Object.values(byAgent)) agent.costUsd *= factor;
    }

    let total = Object.values(byAgent).reduce((sum, a) => addUsage(sum, a.usage), EMPTY_USAGE);
    if (this.result?.modelUsage && Object.keys(this.result.modelUsage).length > 0) {
      total = Object.values(this.result.modelUsage).reduce(
        (sum, m) =>
          addUsage(sum, {
            inputTokens: m.inputTokens,
            outputTokens: m.outputTokens,
            cacheReadTokens: m.cacheReadInputTokens,
            cacheWriteTokens: m.cacheCreationInputTokens,
          }),
        EMPTY_USAGE,
      );
    }

    return {
      total,
      costUsd: typeof official === 'number' ? official : estimated,
      byAgent,
    };
  }
}
