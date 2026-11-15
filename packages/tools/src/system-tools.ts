import { redact, type JsonValue } from '@givance/core';
import { z } from 'zod';
import { defineTool, type ToolDefinition } from './definitions';
import type { Registry } from './registry';
import { requestAction } from './request-action';
import type { RolePermissions } from './types';

/**
 * Ferramentas de sistema, disponíveis desde a Fase 1a. As específicas de cada integração
 * (Instagram, Gmail, Agenda, WhatsApp) entram nas etapas seguintes.
 */

export const memoriaBuscar = defineTool({
  name: 'memoria_buscar',
  description:
    'Busca na memória da empresa: documentos, regras, decisões registradas e informações de produtos. ' +
    'Use antes de afirmar qualquer fato sobre a empresa (preços, horários, serviços, regras de comunicação).',
  input: {
    consulta: z.string().min(2).max(500).describe('O que procurar, em português.'),
    limite: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe('Quantos trechos devolver (padrão 5).'),
  },
  async handler(ctx, args) {
    const hits = await ctx.services.knowledge.search(
      ctx.task.orgId,
      args.consulta,
      args.limite ?? 5,
    );
    if (hits.length === 0) {
      return {
        text: 'Nada encontrado na memória da empresa para essa busca. Não invente: diga que a informação não está registrada.',
      };
    }
    const linhas = hits.map(
      (hit, index) => `${index + 1}. [${hit.title}] ${hit.content.replace(/\s+/g, ' ').trim()}`,
    );
    return { text: `Trechos encontrados na memória da empresa:\n${linhas.join('\n')}` };
  },
});

export const salvarArtefato = defineTool({
  name: 'salvar_artefato',
  description:
    'Entrega o resultado do seu trabalho de forma estruturada (ex.: legenda de post, briefing, resumo). ' +
    'O orquestrador lê os artefatos para montar a resposta final. Salve uma vez por entrega; ' +
    'salvar de novo com o mesmo tipo cria uma nova versão.',
  input: {
    tipo: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/)
      .describe('Tipo do artefato em snake_case, ex.: legenda_post, briefing_criativo.'),
    titulo: z.string().min(1).max(300).describe('Título curto, em português.'),
    dados: z.record(z.string(), z.unknown()).describe('Conteúdo estruturado (objeto JSON).'),
  },
  async handler(ctx, args) {
    const artifact = await ctx.services.artifacts.save({
      orgId: ctx.task.orgId,
      taskId: ctx.task.taskId,
      kind: args.tipo,
      title: args.titulo,
      data: args.dados as JsonValue,
      createdByAgent: ctx.agent,
    });
    await ctx.services.audit.log({
      orgId: ctx.task.orgId,
      actorType: 'agente',
      actorId: ctx.agent,
      action: 'artefato.salvo',
      target: `artifact:${artifact.id}`,
      taskId: ctx.task.taskId,
      runId: ctx.task.runId,
      payload: redact({ tipo: args.tipo, versao: artifact.version }),
    });
    return {
      text: `Artefato "${args.titulo}" salvo (tipo ${args.tipo}, versão ${artifact.version}).`,
    };
  },
});

export const artefatosListar = defineTool({
  name: 'artefatos_listar',
  description:
    'Lista os artefatos já salvos nesta tarefa pelos especialistas, com o conteúdo de cada um. ' +
    'Use para juntar os resultados antes de responder ou de pedir uma ação.',
  input: {},
  async handler(ctx) {
    const artifacts = await ctx.services.artifacts.list(ctx.task.orgId, ctx.task.taskId);
    if (artifacts.length === 0) {
      return { text: 'Nenhum artefato salvo nesta tarefa ainda.' };
    }
    const blocos = artifacts.map(
      (artifact) =>
        `## ${artifact.title} (tipo ${artifact.kind}, v${artifact.version}, por ${artifact.createdByAgent})\n` +
        JSON.stringify(artifact.data, null, 2),
    );
    return { text: blocos.join('\n\n') };
  },
});

export const clienteResponder = defineTool({
  name: 'cliente_responder',
  description:
    'Manda uma mensagem para o dono da empresa na conversa desta tarefa (painel e, a partir da Fase 1b, WhatsApp). ' +
    'Use para o resumo final, para avisar que algo está aguardando a decisão dele ou para tirar uma dúvida. ' +
    'Seja breve e direto, em português.',
  input: {
    mensagem: z.string().min(1).max(4000).describe('Texto da mensagem para o dono.'),
  },
  async handler(ctx, args) {
    const { messageId } = await ctx.services.messages.sendToOwner(
      ctx.task.orgId,
      ctx.task.taskId,
      args.mensagem,
    );
    await ctx.services.audit.log({
      orgId: ctx.task.orgId,
      actorType: 'agente',
      actorId: ctx.agent,
      action: 'mensagem.para_dono',
      target: `message:${messageId}`,
      taskId: ctx.task.taskId,
      runId: ctx.task.runId,
    });
    return { text: 'Mensagem registrada para o dono.' };
  },
});

/** Texto que descreve, para o modelo, as ações que o cargo pode pedir e o formato de cada uma. */
export function describeActions(registry: Registry, permissions: RolePermissions): string {
  const linhas: string[] = [];
  for (const action of registry.implementedActions()) {
    if (action.destructive || permissions.acoes_proibidas.includes(action.type)) {
      continue;
    }
    const schema = JSON.stringify(z.toJSONSchema(action.payload));
    linhas.push(`- ${action.type}: ${action.description}\n  Formato de "dados": ${schema}`);
  }
  if (linhas.length === 0) {
    return 'Nenhuma ação disponível para este cargo no momento.';
  }
  return linhas.join('\n');
}

export function createAcaoSolicitar(actionsDescription: string): ToolDefinition {
  return defineTool({
    name: 'acao_solicitar',
    description:
      'Pede uma ação que mexe com o mundo real (publicar, enviar, gastar, registrar). Você não executa ' +
      'ações diretamente: o pedido passa pelas regras de segurança e, conforme o nível de autonomia, ' +
      'espera a decisão do dono. Depois de pedir, não repita o mesmo pedido.\n\nAções disponíveis:\n' +
      actionsDescription,
    input: {
      tipo: z.string().describe('Tipo da ação, ex.: memoria.registrar.'),
      dados: z
        .record(z.string(), z.unknown())
        .describe('Dados da ação, no formato indicado para o tipo.'),
      motivo: z
        .string()
        .min(5)
        .max(1000)
        .describe('Por que esta ação é necessária. Aparece para o dono junto da prévia.'),
    },
    async handler(ctx, args) {
      const result = await requestAction(ctx, {
        type: args.tipo,
        payload: args.dados,
        reason: args.motivo,
      });
      switch (result.status) {
        case 'invalida':
          return {
            isError: true,
            text: `${result.message}\nProblemas:\n${result.problems.map((p) => `- ${p}`).join('\n')}`,
          };
        case 'desconhecida':
        case 'proibida':
          return { isError: true, text: result.message };
        default:
          return {
            text: `${result.message} (aprovação ${result.approvalId}, nível ${result.level})`,
          };
      }
    },
  });
}

/** Ferramentas de sistema que valem para todos os cargos. */
export function systemTools(actionsDescription: string): ToolDefinition[] {
  return [
    memoriaBuscar,
    salvarArtefato,
    artefatosListar,
    clienteResponder,
    createAcaoSolicitar(actionsDescription),
  ];
}

/** Nomes das ferramentas de sistema (para validação de cargos sem montar as ferramentas). */
export const SYSTEM_TOOL_NAMES = [
  'memoria_buscar',
  'salvar_artefato',
  'artefatos_listar',
  'cliente_responder',
  'acao_solicitar',
] as const;
