import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
  type SdkMcpToolDefinition,
} from '@anthropic-ai/claude-agent-sdk';
import { errorMessage } from '@givance/core';
import type { ToolCallContext, ToolDefinition } from '@givance/tools';
import type { AgentAttribution } from './hooks';

export const MCP_SERVER_NAME = 'givance';

/** Nome completo com que o modelo vê a ferramenta. */
export function mcpToolName(name: string): string {
  return `mcp__${MCP_SERVER_NAME}__${name}`;
}

export interface ToolServerInput {
  tools: ToolDefinition[];
  /** Contexto da tarefa; o agente de cada chamada é preenchido pela atribuição. */
  context: Omit<ToolCallContext, 'agent'>;
  maxCallsPerTool: number;
  attribution: AgentAttribution;
  onError?: (toolName: string, error: unknown) => void;
}

type CallResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

function texto(text: string, isError = false): CallResult {
  return isError
    ? { content: [{ type: 'text', text }], isError: true }
    : { content: [{ type: 'text', text }] };
}

/**
 * Converte as ferramentas da Givance para o formato do SDK. Cada chamada conta para o limite
 * por ferramenta, marca a execução como "contaminada" quando a ferramenta devolve conteúdo de
 * terceiros e nunca deixa um erro interno vazar como exceção.
 */
export function buildSdkTools(input: ToolServerInput): SdkMcpToolDefinition[] {
  const { context, maxCallsPerTool, attribution } = input;

  return input.tools.map(
    (definition) =>
      tool(
        definition.name,
        definition.description,
        definition.input,
        async (args: Record<string, unknown>, extra: unknown) => {
          const agent = attribution.take(mcpToolName(definition.name), extra);
          const chamadas = (context.run.toolCalls.get(definition.name) ?? 0) + 1;
          context.run.toolCalls.set(definition.name, chamadas);
          if (chamadas > maxCallsPerTool) {
            return texto(
              `Limite de ${maxCallsPerTool} chamadas de ${definition.name} nesta tarefa atingido. ` +
                'Termine com o que já tem e explique ao dono o que ficou pendente.',
              true,
            );
          }
          try {
            const result = await definition.handler({ ...context, agent }, args as never);
            if (definition.untrustedOutput) {
              context.run.tainted = true;
            }
            return texto(result.text, result.isError === true);
          } catch (error) {
            input.onError?.(definition.name, error);
            return texto(
              `Erro ao executar ${definition.name}: ${errorMessage(error)}. Tente outra abordagem ou avise o dono.`,
              true,
            );
          }
        },
        { alwaysLoad: true },
      ) as unknown as SdkMcpToolDefinition,
  );
}

/** Servidor MCP que roda no mesmo processo do worker, com as ferramentas da execução. */
export function buildToolServer(input: ToolServerInput): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: MCP_SERVER_NAME,
    version: '1.0.0',
    tools: buildSdkTools(input),
    alwaysLoad: true,
  });
}
