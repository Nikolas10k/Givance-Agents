import { z } from 'zod';
import { PermanentError } from './consumer';

export const taskRunMessage = z.object({
  type: z.literal('task.run'),
  task_id: z.uuid(),
  org_id: z.uuid(),
});

export const actionExecuteMessage = z.object({
  type: z.literal('action.execute'),
  approval_id: z.uuid(),
  org_id: z.uuid(),
});

export const routineFireMessage = z.object({
  type: z.literal('routine.fire'),
  routine_id: z.uuid(),
  org_id: z.uuid(),
});

/** Valida o corpo de uma mensagem; corpo inválido não adianta repetir. */
export function parseMessage<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new PermanentError(
      `Mensagem inválida: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
    );
  }
  return parsed.data;
}

export const whatsappOutboundMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message.deliver'), message_id: z.uuid(), org_id: z.uuid() }),
  z.object({ type: z.literal('approval.notify'), approval_id: z.uuid(), org_id: z.uuid() }),
]);

export const whatsappInboundMessage = z.object({
  type: z.literal('webhook'),
  payload: z.unknown(),
});
