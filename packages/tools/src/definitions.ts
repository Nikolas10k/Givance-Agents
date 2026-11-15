import type { AutonomyLevel, JsonValue, RiskLevel } from '@givance/core';
import type { z } from 'zod';
import type { ActionPreview, RolePermissions, RunState, TaskContext, ToolServices } from './types';

/** Contexto entregue a cada chamada de ferramenta. */
export interface ToolCallContext {
  task: TaskContext;
  run: RunState;
  /** Agente que está chamando (orquestrador ou chave do especialista), quando conhecido. */
  agent: string;
  permissions: RolePermissions;
  services: ToolServices;
  registry: ActionLookup;
}

export interface ToolResult {
  text: string;
  isError?: boolean;
}

export interface ToolDefinition<Shape extends z.ZodRawShape = z.ZodRawShape> {
  /** snake_case, em português (ex.: memoria_buscar). Vira mcp__givance__<nome> no SDK. */
  name: string;
  /** Explica ao modelo quando e como usar. */
  description: string;
  input: Shape;
  /**
   * A saída traz conteúdo de terceiros (e-mail, mensagem de lead, comentário). Depois de
   * uma chamada assim, nenhuma ação desta execução pode ser automática.
   */
  untrustedOutput?: boolean;
  // Assinatura de método (e não de propriedade) para que definições com formatos diferentes
  // caibam numa mesma lista de ToolDefinition.
  handler(ctx: ToolCallContext, args: z.infer<z.ZodObject<Shape>>): Promise<ToolResult>;
}

export function defineTool<Shape extends z.ZodRawShape>(
  definition: ToolDefinition<Shape>,
): ToolDefinition<Shape> {
  return definition;
}

export type GuardResult<Payload> =
  { ok: true; payload: Payload } | { ok: false; problems: string[] };

export interface ActionGuardContext {
  task: TaskContext;
  services: ToolServices;
}

export interface ActionExecuteContext {
  task: TaskContext;
  services: ToolServices;
  approvalId: string;
  /** Chave estável da ação: use-a nas chamadas externas que aceitam idempotência. */
  idempotencyKey: string;
  attempt: number;
}

export interface ActionOutcome {
  /** Frase curta em português sobre o que foi feito (vai para o dono e para o orquestrador). */
  summary: string;
  externalIds?: Record<string, string>;
}

export interface ActionDefinition<Payload extends z.ZodType = z.ZodType> {
  /** dominio.verbo, ex.: instagram.publicar */
  type: string;
  description: string;
  payload: Payload;
  defaultAutonomy: AutonomyLevel;
  /** Piso fixo: a empresa não consegue configurar abaixo disso. */
  minAutonomy?: AutonomyLevel;
  /** Gasta dinheiro: piso "sempre_aprovar". */
  spendsMoney?: boolean;
  /** Apaga algo: proibido. */
  destructive?: boolean;
  risk: RiskLevel;
  /** Checagens de negócio em código. Pode normalizar o payload (ex.: forçar PAUSED). */
  guard?(
    ctx: ActionGuardContext,
    payload: z.infer<Payload>,
  ): Promise<GuardResult<z.infer<Payload>>>;
  preview(payload: z.infer<Payload>): ActionPreview;
  execute(ctx: ActionExecuteContext, payload: z.infer<Payload>): Promise<ActionOutcome>;
}

export function defineAction<Payload extends z.ZodType>(
  definition: ActionDefinition<Payload>,
): ActionDefinition<Payload> {
  return definition;
}

export interface ActionLookup {
  getAction(type: string): ActionDefinition | undefined;
}

/** Ferramenta ou ação prevista no plano, ainda sem implementação. */
export interface PlannedItem {
  name: string;
  phase: string;
  description: string;
}

export type { JsonValue };
