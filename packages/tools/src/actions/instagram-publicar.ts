import { z } from 'zod';
import { checkText } from '../content-policy';
import { defineAction } from '../definitions';
import type { InstagramFormat, MediaInfo } from '../types';

/** Agendamento máximo à frente (o Instagram não agenda; o worker segura a ação). */
const MAX_DIAS_AGENDAMENTO = 75;
/** Horário pedido no passado até este limite vira "publicar agora". */
const TOLERANCIA_PASSADO_MS = 10 * 60_000;

export const FORMAT_LABELS: Record<InstagramFormat, string> = {
  feed: 'foto no feed',
  carrossel: 'carrossel',
  reels: 'reels',
  story: 'story',
};

export const instagramPostPayload = z.strictObject({
  formato: z.enum(['feed', 'carrossel', 'reels', 'story']),
  legenda: z.string().max(2200).default(''),
  midia_ids: z.array(z.uuid()).min(1).max(10),
  recorte: z.enum(['1:1', '4:5', '9:16', 'original']).default('original'),
  /** Data e hora com fuso (ISO 8601). Ausente: publica assim que o dono aprovar. */
  agendar_para: z.iso.datetime({ offset: true }).optional(),
});

export type InstagramPostPayload = z.infer<typeof instagramPostPayload>;

/** Regras de formato x mídia do Instagram. Devolve os problemas encontrados. */
export function checkMediaForFormat(
  formato: InstagramFormat,
  recorte: InstagramPostPayload['recorte'],
  midias: MediaInfo[],
): string[] {
  const problemas: string[] = [];
  const imagens = midias.filter((m) => m.kind === 'imagem').length;
  const videos = midias.filter((m) => m.kind === 'video').length;
  const outros = midias.length - imagens - videos;
  if (outros > 0) problemas.push('Só fotos e vídeos podem ir para o Instagram.');

  switch (formato) {
    case 'feed':
      if (midias.length !== 1 || imagens !== 1) {
        problemas.push(
          'Post de feed leva exatamente uma foto (vídeo no feed é publicado como reels).',
        );
      }
      break;
    case 'carrossel':
      if (midias.length < 2 || midias.length > 10) {
        problemas.push('Carrossel leva de 2 a 10 fotos ou vídeos.');
      }
      break;
    case 'reels':
      if (midias.length !== 1 || videos !== 1) problemas.push('Reels leva exatamente um vídeo.');
      break;
    case 'story':
      if (midias.length !== 1) problemas.push('Story leva exatamente uma foto ou um vídeo.');
      break;
  }

  if (recorte === '9:16' && (formato === 'feed' || formato === 'carrossel')) {
    problemas.push('O recorte 9:16 é só para story; no feed use 4:5, 1:1 ou original.');
  }
  for (const m of midias) {
    if (m.kind === 'video' && m.durationSeconds !== null) {
      if (formato === 'story' && m.durationSeconds > 60) {
        problemas.push('Vídeo de story pode ter até 60 segundos.');
      }
      if (m.durationSeconds < 3) problemas.push('Vídeo com menos de 3 segundos.');
      if (m.durationSeconds > 15 * 60) problemas.push('Vídeo com mais de 15 minutos.');
    }
  }
  return problemas;
}

function formatarQuando(iso: string | undefined): string {
  if (!iso) return 'Assim que você aprovar';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export const instagramPublicar = defineAction({
  type: 'instagram.publicar',
  description:
    'Publica um post no Instagram da empresa (feed, carrossel, reels ou story), agora ou no horário agendado.',
  payload: instagramPostPayload,
  defaultAutonomy: 'confirmar',
  risk: 'medio',

  async guard(ctx, payload) {
    const problemas: string[] = [];
    const conta = await ctx.services.instagram.account(ctx.task.orgId);
    if (!conta) {
      problemas.push(
        'A empresa ainda não conectou o Instagram. Peça ao dono para conectar no painel (menu Instagram).',
      );
    }

    const ids = [...new Set(payload.midia_ids)];
    if (ids.length !== payload.midia_ids.length) problemas.push('Mídia repetida no post.');
    const midias = await ctx.services.media.list(ctx.task.orgId, { ids });
    const encontradas = new Map(midias.map((m) => [m.id, m]));
    const faltando = ids.filter((id) => !encontradas.has(id));
    if (faltando.length > 0) {
      problemas.push(`Mídia não encontrada no banco da empresa: ${faltando.join(', ')}.`);
    } else {
      const ordenadas = ids.map((id) => encontradas.get(id)!);
      problemas.push(...checkMediaForFormat(payload.formato, payload.recorte, ordenadas));
    }

    // Story não tem legenda na API: o texto, se houver, precisa estar na própria imagem.
    const legenda = payload.formato === 'story' ? '' : payload.legenda.trim();
    if (legenda) {
      const politica = await ctx.services.company.contentPolicy(ctx.task.orgId);
      problemas.push(...checkText(legenda, politica, 'legenda').problemas);
    }

    let agendarPara = payload.agendar_para;
    if (agendarPara && ctx.phase === 'pedido') {
      const quando = new Date(agendarPara).getTime();
      const agora = Date.now();
      if (quando < agora - TOLERANCIA_PASSADO_MS) {
        problemas.push('O horário agendado já passou. Proponha outro horário ou publique agora.');
      } else if (quando > agora + MAX_DIAS_AGENDAMENTO * 86_400_000) {
        problemas.push(`Agendamento máximo de ${MAX_DIAS_AGENDAMENTO} dias à frente.`);
      } else if (quando <= agora) {
        agendarPara = undefined;
      }
    }

    if (problemas.length > 0) return { ok: false, problems: problemas };
    const recorte =
      payload.formato === 'story' && payload.recorte === 'original' ? '9:16' : payload.recorte;
    return {
      ok: true,
      payload: {
        ...payload,
        legenda,
        recorte,
        ...(agendarPara ? { agendar_para: agendarPara } : { agendar_para: undefined }),
      },
    };
  },

  preview(payload) {
    const n = payload.midia_ids.length;
    return {
      titulo: `Post no Instagram: ${FORMAT_LABELS[payload.formato]}`,
      resumo: payload.legenda || '(sem legenda)',
      campos: [
        { rotulo: 'Quando', valor: formatarQuando(payload.agendar_para) },
        { rotulo: 'Mídias', valor: n === 1 ? '1 arquivo' : `${n} arquivos` },
        ...(payload.recorte !== 'original' ? [{ rotulo: 'Recorte', valor: payload.recorte }] : []),
      ],
      midia_ids: payload.midia_ids,
      botao_aprovar: payload.agendar_para ? 'Agendar' : 'Publicar',
    };
  },

  notBefore(payload) {
    return payload.agendar_para ? new Date(payload.agendar_para) : null;
  },

  onScheduled(ctx, _payload, at) {
    return ctx.services.instagram.markScheduled(ctx.task.orgId, ctx.approvalId, at.toISOString());
  },

  async execute(ctx, payload) {
    const { mediaId, permalink } = await ctx.services.instagram.publish({
      orgId: ctx.task.orgId,
      taskId: ctx.task.taskId,
      approvalId: ctx.approvalId,
      post: payload,
    });
    return {
      summary: permalink
        ? `Post publicado no Instagram: ${permalink}`
        : 'Post publicado no Instagram.',
      externalIds: { ig_media_id: mediaId, ...(permalink ? { permalink } : {}) },
    };
  },
});
