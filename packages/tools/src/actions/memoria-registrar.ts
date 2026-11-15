import { z } from 'zod';
import { defineAction } from '../definitions';

/**
 * Registra uma decisão ou informação na memória da empresa, para os agentes usarem depois
 * (ex.: "não divulgar preço de clareamento nos posts"). Mudar a memória muda o comportamento
 * futuro dos agentes, então o padrão é pedir confirmação.
 */
export const memoriaRegistrar = defineAction({
  type: 'memoria.registrar',
  description: 'Registra uma decisão ou informação permanente na memória da empresa.',
  payload: z.strictObject({
    titulo: z.string().min(3).max(200),
    conteudo: z.string().min(10).max(4000),
  }),
  defaultAutonomy: 'confirmar',
  risk: 'baixo',
  preview(payload) {
    return {
      titulo: 'Registrar na memória da empresa',
      resumo: payload.conteudo,
      campos: [{ rotulo: 'Título', valor: payload.titulo }],
    };
  },
  async execute(ctx, payload) {
    const { documentId } = await ctx.services.knowledge.addDocument({
      orgId: ctx.task.orgId,
      title: payload.titulo,
      source: 'decisao',
      chunks: [payload.conteudo],
    });
    return {
      summary: `Registrado na memória da empresa: "${payload.titulo}".`,
      externalIds: { knowledge_document_id: documentId },
    };
  },
});
