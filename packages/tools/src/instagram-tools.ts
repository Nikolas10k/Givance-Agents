import { z } from 'zod';
import { FORMAT_LABELS } from './actions/instagram-publicar';
import { checkText, formatPolicyCheck } from './content-policy';
import { defineTool, type ToolDefinition } from './definitions';
import { requestAction } from './request-action';
import type { MediaInfo } from './types';

/** Ferramentas da Fase 1c: banco de mídia, Instagram e checagem de texto. */

function proporcao(m: MediaInfo): string {
  if (!m.width || !m.height) return '';
  const r = m.width / m.height;
  const nomes: Array<[number, string]> = [
    [1, '1:1'],
    [0.8, '4:5'],
    [0.5625, '9:16'],
    [1.7778, '16:9'],
    [1.91, '1,91:1'],
  ];
  const [, nome] = nomes.reduce((a, b) => (Math.abs(b[0] - r) < Math.abs(a[0] - r) ? b : a));
  return ` ${m.width}x${m.height} (~${nome})`;
}

function formatarData(iso: string | null): string {
  if (!iso) return 'sem data';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export const midiaListar = defineTool({
  name: 'midia_listar',
  description:
    'Lista as fotos e vídeos do banco de mídia da empresa (enviados pelo dono no WhatsApp ou no painel), ' +
    'com id, tipo, dimensões e legenda original. As mídias anexadas a esta tarefa aparecem primeiro e ' +
    'marcadas. Use os ids em instagram_preparar_post. Não há como ver a imagem: confie na descrição do ' +
    'dono e nas dimensões.',
  input: {
    limite: z
      .number()
      .int()
      .min(1)
      .max(30)
      .optional()
      .describe('Quantas mídias recentes listar além das anexadas (padrão 10).'),
  },
  async handler(ctx, args) {
    const anexadas = await ctx.services.media.forTask(ctx.task.orgId, ctx.task.taskId);
    const daTarefa =
      anexadas.length > 0 ? await ctx.services.media.list(ctx.task.orgId, { ids: anexadas }) : [];
    const recentes = await ctx.services.media.list(ctx.task.orgId, { limit: args.limite ?? 10 });
    const vistos = new Set(daTarefa.map((m) => m.id));
    const todas = [...daTarefa, ...recentes.filter((m) => !vistos.has(m.id))];
    if (todas.length === 0) {
      return {
        text: 'O banco de mídia está vazio. Peça ao dono para mandar a foto ou o vídeo pelo WhatsApp.',
      };
    }
    const linhas = todas.map((m) => {
      const tipo = m.kind === 'imagem' ? 'foto' : m.kind === 'video' ? 'vídeo' : m.mimeType;
      const duracao =
        m.kind === 'video' && m.durationSeconds ? `, ${Math.round(m.durationSeconds)}s` : '';
      const origem = m.source === 'whatsapp' ? 'WhatsApp' : 'painel';
      const legenda = m.caption ? ` | legenda do dono: "${m.caption.slice(0, 200)}"` : '';
      const marca = vistos.has(m.id) ? ' [anexada a esta tarefa]' : '';
      return `- ${m.id}: ${tipo}${proporcao(m)}${duracao}, ${origem}, ${formatarData(m.createdAt)}${legenda}${marca}`;
    });
    return { text: `Mídias da empresa:\n${linhas.join('\n')}` };
  },
});

export const politicaChecarTexto = defineTool({
  name: 'politica_checar_texto',
  description:
    'Confere um texto público (legenda, mensagem ou anúncio) contra as regras da empresa e do setor: ' +
    'termos proibidos, promessas vetadas, limites do Instagram (2.200 caracteres, 30 hashtags, 20 menções). ' +
    'Use sempre antes de entregar um texto final. Problemas impedem a publicação; alertas pedem revisão.',
  input: {
    texto: z.string().min(1).max(5000).describe('O texto a conferir.'),
    contexto: z
      .enum(['legenda', 'mensagem', 'anuncio'])
      .optional()
      .describe('Onde o texto vai ser usado (padrão: legenda).'),
  },
  async handler(ctx, args) {
    const politica = await ctx.services.company.contentPolicy(ctx.task.orgId);
    return { text: formatPolicyCheck(checkText(args.texto, politica, args.contexto ?? 'legenda')) };
  },
});

async function semConta(orgId: string, ctx: Parameters<ToolDefinition['handler']>[0]) {
  const conta = await ctx.services.instagram.account(orgId);
  return conta
    ? null
    : {
        text: 'A empresa ainda não conectou o Instagram. Avise o dono que ele conecta no painel, no menu Instagram.',
      };
}

export const instagramListarPosts = defineTool({
  name: 'instagram_listar_posts',
  description:
    'Lista os posts mais recentes do Instagram da empresa (tipo, data, legenda, curtidas, comentários, link). ' +
    'Use para não repetir temas e para manter o estilo do perfil.',
  input: {
    limite: z.number().int().min(1).max(25).optional().describe('Quantos posts (padrão 10).'),
  },
  async handler(ctx, args) {
    const aviso = await semConta(ctx.task.orgId, ctx);
    if (aviso) return aviso;
    const posts = await ctx.services.instagram.recentPosts(ctx.task.orgId, {
      limit: args.limite ?? 10,
    });
    if (posts.length === 0) return { text: 'O perfil ainda não tem posts.' };
    const linhas = posts.map(
      (p) =>
        `- ${formatarData(p.data)} | ${p.tipo} | ${p.curtidas ?? '?'} curtidas, ${p.comentarios ?? '?'} comentários | ` +
        `${(p.legenda ?? '(sem legenda)').replace(/\s+/g, ' ').slice(0, 220)}${p.link ? ` | ${p.link}` : ''}`,
    );
    return { text: `Posts recentes:\n${linhas.join('\n')}` };
  },
});

export const instagramInsights = defineTool({
  name: 'instagram_insights',
  description:
    'Métricas dos posts recentes do Instagram da empresa: alcance, curtidas, comentários, salvamentos, ' +
    'compartilhamentos e visualizações. Use para dizer o que funcionou e planejar os próximos posts.',
  input: {
    limite: z
      .number()
      .int()
      .min(1)
      .max(15)
      .optional()
      .describe('Quantos posts recentes analisar (padrão 8).'),
  },
  async handler(ctx, args) {
    const aviso = await semConta(ctx.task.orgId, ctx);
    if (aviso) return aviso;
    const posts = await ctx.services.instagram.recentPosts(ctx.task.orgId, {
      limit: args.limite ?? 8,
      withInsights: true,
    });
    if (posts.length === 0) return { text: 'O perfil ainda não tem posts para analisar.' };
    const nomes: Record<string, string> = {
      reach: 'alcance',
      views: 'visualizações',
      likes: 'curtidas',
      comments: 'comentários',
      saved: 'salvamentos',
      shares: 'compartilhamentos',
      total_interactions: 'interações',
    };
    const linhas = posts.map((p) => {
      const metricas = Object.entries(p.metricas ?? {})
        .map(([k, v]) => `${nomes[k] ?? k} ${v}`)
        .join(', ');
      return `- ${formatarData(p.data)} | ${p.tipo} | ${metricas || 'sem métricas'} | ${(p.legenda ?? '').replace(/\s+/g, ' ').slice(0, 120)}`;
    });
    return { text: `Métricas dos posts recentes:\n${linhas.join('\n')}` };
  },
});

export const instagramPrepararPost = defineTool({
  name: 'instagram_preparar_post',
  description:
    'Monta a prévia de um post do Instagram e pede a publicação (ação instagram.publicar). Nada é publicado ' +
    'aqui: o dono recebe a prévia com a imagem e confirma com um toque. Regras: feed = 1 foto; carrossel = ' +
    '2 a 10 fotos/vídeos; reels = 1 vídeo; story = 1 foto ou vídeo, sem legenda. Recorte: 4:5 é o melhor ' +
    'para feed e carrossel; 9:16 só para story. Para agendar, informe data e hora com fuso ' +
    '(ex.: 2026-11-20T18:00:00-03:00). Depois de pedir, não repita o pedido.',
  input: {
    formato: z.enum(['feed', 'carrossel', 'reels', 'story']).describe('Tipo do post.'),
    legenda: z
      .string()
      .max(2200)
      .optional()
      .describe('Legenda final, já revisada (vazia para story).'),
    midia_ids: z
      .array(z.uuid())
      .min(1)
      .max(10)
      .describe('Ids das mídias, na ordem em que devem aparecer (de midia_listar).'),
    recorte: z
      .enum(['1:1', '4:5', '9:16', 'original'])
      .optional()
      .describe('Recorte das fotos (padrão: original; story usa 9:16).'),
    agendar_para: z
      .string()
      .optional()
      .describe('Data e hora da publicação, ISO 8601 com fuso. Vazio: publica ao aprovar.'),
    motivo: z
      .string()
      .min(5)
      .max(500)
      .describe('Uma frase para o dono: por que este post, por que este horário.'),
  },
  async handler(ctx, args) {
    const result = await requestAction(ctx, {
      type: 'instagram.publicar',
      payload: {
        formato: args.formato,
        legenda: args.legenda ?? '',
        midia_ids: args.midia_ids,
        recorte: args.recorte ?? 'original',
        ...(args.agendar_para ? { agendar_para: args.agendar_para } : {}),
      },
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
        await ctx.services.instagram.saveDraft({
          orgId: ctx.task.orgId,
          taskId: ctx.task.taskId,
          approvalId: result.approvalId,
        });
        return {
          text:
            `${result.message} Post (${FORMAT_LABELS[args.formato]}) registrado com a aprovação ${result.approvalId}. ` +
            'Não peça de novo; avise o dono em uma frase, se ainda não avisou, e encerre.',
        };
    }
  },
});

export const INSTAGRAM_TOOLS: ToolDefinition[] = [
  midiaListar,
  politicaChecarTexto,
  instagramListarPosts,
  instagramInsights,
  instagramPrepararPost,
];
