import path from 'node:path';
import {
  BUILTIN_TOOL_NAMES,
  SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
  type AgentDefinition,
  type HookCallbackMatcher,
  type HookEvent,
  type McpSdkServerConfigWithInstance,
  type Options,
} from '@anthropic-ai/claude-agent-sdk';
import type { ResolvedRole } from '@givance/core';
import type { LoadedPrompt } from '../content';
import { MCP_SERVER_NAME } from './tool-server';
import { ORCHESTRATOR } from './usage';

/** Ferramentas MCP (nome completo) que cada agente pode usar nesta execução. */
export type ToolPlan = Map<string, Set<string>>;

export interface AgentOptionsInput {
  role: ResolvedRole;
  prompts: { orchestrator: LoadedPrompt; specialists: Record<string, LoadedPrompt> };
  /** Bloco "Contexto da empresa" (estável por empresa, aproveita cache). */
  companyContext: string;
  toolPlan: ToolPlan;
  toolServer: McpSdkServerConfigWithInstance;
  hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
  workDir: string;
  apiKey: string;
  abortController?: AbortController;
  stderr?: (data: string) => void;
}

/**
 * Opções do Agent SDK para uma execução de tarefa, em modo isolado:
 * - nenhuma ferramenta nativa do Claude Code, só a delegação (Agent) e as da Givance;
 * - permissões: o que não está em allowedTools é negado (modo dontAsk) e os hooks
 *   PreToolUse conferem cada chamada por agente;
 * - sem configurações, CLAUDE.md, skills ou servidores MCP do sistema de arquivos;
 * - pasta de trabalho e de configuração vazias e próprias da execução;
 * - limites de turnos e de custo vindos do cargo.
 */
export function buildAgentOptions(input: AgentOptionsInput): Options {
  const { role } = input;

  const agents: Record<string, AgentDefinition> = {};
  for (const [key, specialist] of Object.entries(role.especialistas)) {
    const prompt = input.prompts.specialists[key];
    if (!prompt) {
      throw new Error(`Prompt do especialista "${key}" não carregado.`);
    }
    agents[key] = {
      description: specialist.descricao,
      prompt: `${prompt.text}\n\n${input.companyContext}`,
      tools: [...(input.toolPlan.get(key) ?? [])].sort(),
      model: specialist.modelo,
      ...(specialist.esforco ? { effort: specialist.esforco } : {}),
      ...(specialist.turnos_maximos ? { maxTurns: specialist.turnos_maximos } : {}),
      background: false,
      omitClaudeMd: true,
    };
  }

  const allMcpTools = new Set<string>();
  for (const tools of input.toolPlan.values()) tools.forEach((t) => allMcpTools.add(t));

  const orchestrator = role.orquestrador;
  return {
    model: orchestrator.modelo,
    ...(orchestrator.esforco ? { effort: orchestrator.esforco } : {}),
    systemPrompt: [
      input.prompts.orchestrator.text,
      SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
      input.companyContext,
    ],
    agents,
    tools: ['Agent'],
    allowedTools: ['Agent', ...[...allMcpTools].sort()],
    disallowedTools: BUILTIN_TOOL_NAMES.filter((name) => name !== 'Agent'),
    mcpServers: { [MCP_SERVER_NAME]: input.toolServer },
    strictMcpConfig: true,
    settingSources: [],
    skills: [],
    permissionMode: 'dontAsk',
    hooks: input.hooks,
    persistSession: false,
    forwardSubagentText: true,
    maxTurns: orchestrator.turnos_maximos ?? role.limites.turnos_maximos,
    maxBudgetUsd: role.limites.custo_maximo_usd_por_tarefa,
    cwd: input.workDir,
    env: {
      PATH: process.env.PATH,
      HOME: input.workDir,
      CLAUDE_CONFIG_DIR: path.join(input.workDir, '.claude'),
      ANTHROPIC_API_KEY: input.apiKey,
      CLAUDE_AGENT_SDK_CLIENT_APP: 'givance-workforce/0.1.0',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      DISABLE_AUTOUPDATER: '1',
      ...(process.env.HTTPS_PROXY ? { HTTPS_PROXY: process.env.HTTPS_PROXY } : {}),
      ...(process.env.NODE_EXTRA_CA_CERTS
        ? { NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS }
        : {}),
    },
    ...(input.abortController ? { abortController: input.abortController } : {}),
    ...(input.stderr ? { stderr: input.stderr } : {}),
  };
}

/** Agente do fluxo principal (usado para montar o plano de ferramentas). */
export const MAIN_AGENT = ORCHESTRATOR;
