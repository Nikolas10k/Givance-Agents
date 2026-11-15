import { formatZodIssues, redact, type AutonomyLevel, type JsonValue } from '@givance/core';
import { resolveAutonomy } from './autonomy-engine';
import type { ToolCallContext } from './definitions';
import { actionIdempotencyKey } from './idempotency';

export type RequestActionResult =
  | { status: 'desconhecida'; message: string }
  | { status: 'invalida'; message: string; problems: string[] }
  | { status: 'proibida'; message: string }
  | {
      status: 'pendente' | 'aprovada_automaticamente' | 'ja_registrada';
      message: string;
      approvalId: string;
      level: AutonomyLevel;
    };

/**
 * Um agente propõe uma ação. Nada externo acontece aqui: a ação é validada, passa pelos
 * guards e vira uma aprovação (pendente, ou já aprovada quando o nível é automático).
 * Quem executa é o worker, depois, a partir da fila "acoes".
 */
export async function requestAction(
  ctx: ToolCallContext,
  input: { type: string; payload: unknown; reason?: string },
): Promise<RequestActionResult> {
  const definition = ctx.registry.getAction(input.type);
  if (!definition) {
    return {
      status: 'desconhecida',
      message: `Tipo de ação desconhecido ou ainda não disponível: ${input.type}.`,
    };
  }

  const parsed = definition.payload.safeParse(input.payload);
  if (!parsed.success) {
    const problems = formatZodIssues(parsed.error);
    return {
      status: 'invalida',
      message: 'Os dados da ação não passaram na validação. Corrija e tente de novo.',
      problems,
    };
  }

  let payload = parsed.data;
  if (definition.guard) {
    const guarded = await definition.guard({ task: ctx.task, services: ctx.services }, payload);
    if (!guarded.ok) {
      return {
        status: 'invalida',
        message: 'A ação foi barrada pelas regras de segurança.',
        problems: guarded.problems,
      };
    }
    payload = guarded.payload;
  }

  const orgLevel = await ctx.services.autonomy.getLevel(ctx.task.orgId, definition.type);
  const decision = resolveAutonomy({
    action: definition,
    roleLevel: ctx.permissions.acoes[definition.type],
    orgLevel,
    roleForbidden: ctx.permissions.acoes_proibidas.includes(definition.type),
    tainted: ctx.run.tainted,
  });

  if (!decision.allowed) {
    await ctx.services.audit.log({
      orgId: ctx.task.orgId,
      actorType: 'agente',
      actorId: ctx.agent,
      action: 'acao.proibida',
      target: definition.type,
      reason: decision.reason,
      taskId: ctx.task.taskId,
      runId: ctx.task.runId,
    });
    return { status: 'proibida', message: decision.reason };
  }

  const idempotencyKey = actionIdempotencyKey(ctx.task.taskId, definition.type, payload);
  const existing = await ctx.services.approvals.findByIdempotencyKey(
    ctx.task.orgId,
    idempotencyKey,
  );
  if (existing) {
    return {
      status: 'ja_registrada',
      message: `Esta mesma ação já foi registrada (situação: ${existing.status}). Não repita o pedido.`,
      approvalId: existing.id,
      level: existing.autonomyLevel,
    };
  }

  const autoApproved = decision.level === 'automatico';
  const preview = definition.preview(payload);
  const approval = await ctx.services.approvals.create({
    orgId: ctx.task.orgId,
    taskId: ctx.task.taskId,
    runId: ctx.task.runId,
    actionType: definition.type,
    payload: payload as JsonValue,
    preview,
    reason: input.reason?.slice(0, 2000) ?? null,
    autonomyLevel: decision.level,
    riskLevel: definition.risk,
    requestedByAgent: ctx.agent,
    idempotencyKey,
    autoApproved,
  });

  await ctx.services.audit.log({
    orgId: ctx.task.orgId,
    actorType: 'agente',
    actorId: ctx.agent,
    action: 'acao.solicitada',
    target: `approval:${approval.id}`,
    reason: input.reason,
    taskId: ctx.task.taskId,
    runId: ctx.task.runId,
    payload: redact({
      tipo: definition.type,
      nivel: decision.level,
      pisos: decision.reasons,
      payload,
    }),
  });

  if (autoApproved) {
    return {
      status: 'aprovada_automaticamente',
      message: 'Ação aprovada automaticamente pela política da empresa. O sistema vai executá-la.',
      approvalId: approval.id,
      level: decision.level,
    };
  }

  const comoDecide =
    decision.level === 'sempre_aprovar'
      ? 'O dono precisa aprovar no painel.'
      : 'O dono vai receber a prévia para confirmar.';
  return {
    status: 'pendente',
    message: `Ação registrada e aguardando decisão. ${comoDecide} Não execute nada por conta própria.`,
    approvalId: approval.id,
    level: decision.level,
  };
}
