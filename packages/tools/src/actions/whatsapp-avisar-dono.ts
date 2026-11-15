import { z } from 'zod';
import { defineAction } from '../definitions';

/** Aviso curto no WhatsApp do próprio dono (ex.: e-mail importante chegou). */
export const whatsappAvisarDono = defineAction({
  type: 'whatsapp.avisar_dono',
  description: 'Manda um aviso curto para o WhatsApp do próprio dono da empresa.',
  payload: z.strictObject({
    mensagem: z.string().min(3).max(1000),
  }),
  defaultAutonomy: 'automatico',
  selfDirected: true,
  risk: 'baixo',
  preview(payload) {
    return { titulo: 'Aviso no seu WhatsApp', resumo: payload.mensagem };
  },
  async execute(ctx, payload) {
    const result = await ctx.services.messages.notifyOwner({
      orgId: ctx.task.orgId,
      employeeId: ctx.task.employeeId,
      taskId: ctx.task.taskId,
      content: payload.mensagem,
    });
    if (!result) {
      return { summary: 'Aviso não enviado: a empresa ainda não ligou um WhatsApp verificado.' };
    }
    return {
      summary: 'Aviso enviado para o WhatsApp do dono.',
      externalIds: { message_id: result.messageId },
    };
  },
});
