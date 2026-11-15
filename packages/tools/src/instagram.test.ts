import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { checkMediaForFormat, instagramPublicar } from './actions/instagram-publicar';
import { checkText, countHashtags } from './content-policy';
import type { ToolCallContext } from './definitions';
import { createDefaultRegistry } from './default-registry';
import { executeApprovedAction } from './execute-action';
import {
  instagramInsights,
  instagramPrepararPost,
  midiaListar,
  politicaChecarTexto,
} from './instagram-tools';
import { createMemoryServices } from './testing';
import { createRunState, type MediaInfo } from './types';

const ORG = randomUUID();

function contexto() {
  const memory = createMemoryServices();
  const registry = createDefaultRegistry();
  const ctx: ToolCallContext = {
    task: {
      orgId: ORG,
      taskId: randomUUID(),
      employeeId: randomUUID(),
      runId: null,
      taskSource: 'whatsapp',
    },
    run: createRunState(),
    agent: 'social',
    permissions: { acoes: { 'instagram.publicar': 'confirmar' }, acoes_proibidas: [] },
    services: memory.services,
    registry,
  };
  return { memory, registry, ctx };
}

const midia = (kind: MediaInfo['kind'], extra: Partial<MediaInfo> = {}): MediaInfo => ({
  id: randomUUID(),
  kind,
  mimeType: kind === 'video' ? 'video/mp4' : 'image/jpeg',
  width: 1080,
  height: 1350,
  durationSeconds: kind === 'video' ? 20 : null,
  caption: null,
  source: 'whatsapp',
  createdAt: new Date().toISOString(),
  ...extra,
});

describe('checagem de texto', () => {
  it('bloqueia termos da empresa e promessas vetadas do setor, sem ligar para acentos', () => {
    const r = checkText('Clareamento SEM DOR e com Resultado Garantido! Veja o antes e depois.', {
      doNotSay: ['o melhor da cidade', 'Promoção relâmpago'],
      regulatedSector: 'saude',
    });
    expect(r.problemas).toEqual(
      expect.arrayContaining([
        expect.stringContaining('sem dor'),
        expect.stringContaining('resultado garantido'),
        expect.stringContaining('antes e depois'),
      ]),
    );
    expect(
      checkText('Promocao relampago hoje', {
        doNotSay: ['Promoção relâmpago'],
        regulatedSector: null,
      }).problemas,
    ).toHaveLength(1);
    // Palavra inteira: "semdor" não é "sem dor"; setor não regulado não bloqueia.
    expect(
      checkText('Atendimento sem dor de cabeça', { doNotSay: [], regulatedSector: null }).problemas,
    ).toEqual([]);
  });

  it('limites do Instagram e alertas', () => {
    const hashtags = Array.from({ length: 31 }, (_, i) => `#tag${i}`).join(' ');
    expect(countHashtags(hashtags)).toBe(31);
    const r = checkText(`Texto ${hashtags}`, { doNotSay: [], regulatedSector: null });
    expect(r.problemas).toEqual([expect.stringContaining('31 hashtags')]);
    expect(
      checkText('Garantimos 100% de satisfação', { doNotSay: [], regulatedSector: null }).alertas,
    ).toHaveLength(2);
  });
});

describe('regras de formato do Instagram', () => {
  it('feed: uma foto; reels: um vídeo; carrossel: 2 a 10; 9:16 só em story', () => {
    expect(checkMediaForFormat('feed', '4:5', [midia('imagem')])).toEqual([]);
    expect(checkMediaForFormat('feed', '4:5', [midia('video')])).toHaveLength(1);
    expect(checkMediaForFormat('reels', 'original', [midia('video')])).toEqual([]);
    expect(checkMediaForFormat('reels', 'original', [midia('imagem')])).toHaveLength(1);
    expect(checkMediaForFormat('carrossel', '1:1', [midia('imagem')])).toHaveLength(1);
    expect(checkMediaForFormat('carrossel', '1:1', [midia('imagem'), midia('video')])).toEqual([]);
    expect(checkMediaForFormat('feed', '9:16', [midia('imagem')])).toHaveLength(1);
    expect(checkMediaForFormat('story', '9:16', [midia('video', { durationSeconds: 90 })])).toEqual(
      [expect.stringContaining('60 segundos')],
    );
  });
});

describe('instagram_preparar_post', () => {
  it('pede a publicação, registra o rascunho e monta a prévia com a mídia', async () => {
    const { ctx, memory } = contexto();
    const foto = memory.addMedia(ORG, { kind: 'imagem' }, ctx.task.taskId);
    const quando = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const r = await instagramPrepararPost.handler(ctx, {
      formato: 'feed',
      legenda: 'Promoção de limpeza nesta semana! #sorriso',
      midia_ids: [foto],
      recorte: '4:5',
      agendar_para: quando,
      motivo: 'Dono pediu post da promoção',
    });
    expect(r.isError).toBeFalsy();
    const [ap] = memory.state.approvals;
    expect(ap).toMatchObject({
      actionType: 'instagram.publicar',
      status: 'pendente',
      autonomyLevel: 'confirmar',
    });
    expect(ap!.preview).toMatchObject({
      titulo: 'Post no Instagram: foto no feed',
      midia_ids: [foto],
      botao_aprovar: 'Agendar',
    });
    expect(memory.state.drafts).toEqual([expect.objectContaining({ approvalId: ap!.id })]);

    // Pedir de novo não duplica.
    await instagramPrepararPost.handler(ctx, {
      formato: 'feed',
      legenda: 'Promoção de limpeza nesta semana! #sorriso',
      midia_ids: [foto],
      recorte: '4:5',
      agendar_para: quando,
      motivo: 'Dono pediu post da promoção',
    });
    expect(memory.state.approvals).toHaveLength(1);
    expect(memory.state.drafts).toHaveLength(1);
  });

  it('barra post sem Instagram conectado, com mídia de outra empresa ou horário passado', async () => {
    const { ctx, memory } = contexto();
    const deOutra = memory.addMedia(randomUUID(), { kind: 'imagem' });
    const r1 = await instagramPrepararPost.handler(ctx, {
      formato: 'feed',
      midia_ids: [deOutra],
      motivo: 'teste de mídia',
    });
    expect(r1).toMatchObject({ isError: true });
    expect(r1.text).toContain('não encontrada');

    const foto = memory.addMedia(ORG, { kind: 'imagem' });
    const r2 = await instagramPrepararPost.handler(ctx, {
      formato: 'feed',
      midia_ids: [foto],
      agendar_para: new Date(Date.now() - 3_600_000).toISOString(),
      motivo: 'teste de horário',
    });
    expect(r2.text).toContain('já passou');

    memory.setInstagramAccount(null);
    const r3 = await instagramPrepararPost.handler(ctx, {
      formato: 'feed',
      midia_ids: [foto],
      motivo: 'teste de conexão',
    });
    expect(r3.text).toContain('não conectou o Instagram');
    expect(memory.state.approvals).toHaveLength(0);
  });

  it('legenda com termo proibido não vira aprovação; story perde a legenda e usa 9:16', async () => {
    const { ctx, memory } = contexto();
    memory.setContentPolicy({ doNotSay: ['garantimos resultado'], regulatedSector: null });
    const foto = memory.addMedia(ORG, { kind: 'imagem' });
    const ruim = await instagramPrepararPost.handler(ctx, {
      formato: 'feed',
      legenda: 'Garantimos resultado!',
      midia_ids: [foto],
      motivo: 'teste',
    });
    expect(ruim.text).toContain('não usa o termo');

    await instagramPrepararPost.handler(ctx, {
      formato: 'story',
      legenda: 'Garantimos resultado!',
      midia_ids: [foto],
      motivo: 'story sem legenda',
    });
    expect(memory.state.approvals[0]!.payload).toMatchObject({ legenda: '', recorte: '9:16' });
  });

  it('o cargo sem permissão não consegue pedir', async () => {
    const { ctx, memory } = contexto();
    ctx.permissions = { acoes: { 'memoria.registrar': 'confirmar' }, acoes_proibidas: [] };
    const foto = memory.addMedia(ORG, { kind: 'imagem' });
    const r = await instagramPrepararPost.handler(ctx, {
      formato: 'feed',
      midia_ids: [foto],
      motivo: 'teste',
    });
    expect(r).toMatchObject({ isError: true });
    expect(r.text).toContain('não tem permissão');
  });
});

describe('execução de instagram.publicar', () => {
  it('publica uma vez, com o horário passado do agendamento aceito na execução', async () => {
    const { ctx, memory, registry } = contexto();
    const foto = memory.addMedia(ORG, { kind: 'imagem' });
    await instagramPrepararPost.handler(ctx, {
      formato: 'feed',
      legenda: 'Bom dia!',
      midia_ids: [foto],
      agendar_para: new Date(Date.now() + 60_000).toISOString(),
      motivo: 'teste',
    });
    const ap = memory.state.approvals[0]!;
    expect(instagramPublicar.notBefore!(ap.payload as never)).toBeInstanceOf(Date);
    memory.decide(ap.id, 'aprovada');
    // Simula o worker atrasado: o horário já passou há 30 min, mas a ação já estava aprovada.
    (ap.payload as { agendar_para: string }).agendar_para = new Date(
      Date.now() - 30 * 60_000,
    ).toISOString();

    const deps = {
      services: memory.services,
      registry,
      orgId: ORG,
      approvalId: ap.id,
      employeeId: ctx.task.employeeId,
    };
    expect(await executeApprovedAction(deps)).toMatchObject({
      status: 'sucesso',
      summary: 'Post publicado no Instagram: https://www.instagram.com/p/teste1/',
    });
    expect(await executeApprovedAction(deps)).toMatchObject({ status: 'ignorada' });
    expect(memory.state.published).toHaveLength(1);
  });
});

describe('leitura', () => {
  it('midia_listar mostra primeiro as anexadas à tarefa', async () => {
    const { ctx, memory } = contexto();
    memory.addMedia(ORG, { kind: 'video', caption: 'vídeo antigo' });
    const anexada = memory.addMedia(
      ORG,
      { kind: 'imagem', width: 1080, height: 1080 },
      ctx.task.taskId,
    );
    const r = await midiaListar.handler(ctx, {});
    const linhas = r.text.split('\n');
    expect(linhas[1]).toContain(anexada);
    expect(linhas[1]).toContain('[anexada a esta tarefa]');
    expect(linhas[1]).toContain('1080x1080 (~1:1)');
    expect(r.text).toContain('legenda do dono: "vídeo antigo"');
  });

  it('insights e checagem de texto pela ferramenta', async () => {
    const { ctx, memory } = contexto();
    memory.state.instagramPosts.push({
      id: 'm1',
      tipo: 'FEED',
      legenda: 'Post de teste',
      data: new Date().toISOString(),
      link: null,
      curtidas: 3,
      comentarios: 1,
      metricas: { reach: 120, saved: 4 },
    });
    expect((await instagramInsights.handler(ctx, {})).text).toContain('alcance 120, salvamentos 4');
    expect(
      (await politicaChecarTexto.handler(ctx, { texto: 'Tudo certo por aqui.' })).text,
    ).toContain('nenhum problema');
    memory.setInstagramAccount(null);
    expect((await instagramInsights.handler(ctx, {})).text).toContain('não conectou');
  });
});
