import { errorMessage } from '@givance/core';
import { assertOk, unwrap, unwrapMaybe, type TablesUpdate, type TypedClient } from '@givance/db';
import {
  createInstagramClient,
  InstagramError,
  refreshInstagramToken,
  type ContainerStatus,
  type InstagramClient,
  type InstagramClientConfig,
} from '@givance/integrations';
import {
  instagramPostPayload,
  RetryableActionError,
  type InstagramPostRequest,
  type InstagramPostSummary,
  type ToolServices,
} from '@givance/tools';
import { prepareImage, targetAspect } from './imagem';

export type InstagramApi = Pick<
  InstagramClient,
  | 'createImageContainer'
  | 'createVideoContainer'
  | 'createCarouselContainer'
  | 'containerStatus'
  | 'publish'
  | 'media'
  | 'listMedia'
  | 'insights'
  | 'publishingLimit'
>;

export interface InstagramServiceDeps {
  db: TypedClient;
  graphVersion?: string;
  /** Para testes: substitui o cliente da Graph API. */
  createClient?: (config: InstagramClientConfig) => InstagramApi;
  sleep?: (ms: number) => Promise<void>;
  /** Quanto esperar o contêiner ficar pronto antes de devolver a ação à fila. */
  containerTimeoutMs?: { imagem: number; video: number };
}

/** URLs assinadas vivem o bastante para o Instagram baixar a mídia. */
const URL_VALIDADE_S = 3600;
const POLL_MS = 3000;

interface Conexao {
  id: string;
  igUserId: string;
  username: string;
}

/**
 * Instagram da empresa no worker: lê a conexão e o token (Vault), prepara a mídia, cria os
 * contêineres e publica. A publicação é retomável: o id do contêiner fica salvo no post, e uma
 * nova tentativa continua de onde parou em vez de criar outro post.
 */
export function createInstagramService(deps: InstagramServiceDeps): ToolServices['instagram'] {
  const { db } = deps;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const timeouts = deps.containerTimeoutMs ?? { imagem: 90_000, video: 300_000 };
  const makeClient =
    deps.createClient ?? ((config: InstagramClientConfig) => createInstagramClient(config));

  async function conexao(orgId: string): Promise<Conexao | null> {
    const row = unwrapMaybe(
      'instagram: conexão',
      await db
        .from('connections')
        .select('id, external_ids')
        .eq('org_id', orgId)
        .eq('provider', 'instagram')
        .eq('status', 'ativa')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    );
    if (!row) return null;
    const ids = row.external_ids as { ig_user_id?: string; username?: string };
    if (!ids.ig_user_id) return null;
    return { id: row.id, igUserId: ids.ig_user_id, username: ids.username ?? '' };
  }

  async function cliente(orgId: string): Promise<{ api: InstagramApi; conexao: Conexao }> {
    const c = await conexao(orgId);
    if (!c) throw new Error('A empresa não tem Instagram conectado.');
    const token = await db.rpc('connection_secret_get', { p_connection_id: c.id });
    if (token.error || !token.data) {
      throw new Error('Token do Instagram não encontrado; reconecte a conta no painel.');
    }
    return {
      api: makeClient({
        accessToken: token.data,
        igUserId: c.igUserId,
        ...(deps.graphVersion ? { graphVersion: deps.graphVersion } : {}),
      }),
      conexao: c,
    };
  }

  /** Token revogado ou vencido: marca a conexão para o dono reconectar. */
  async function marcarConexaoInvalida(conexaoId: string, error: unknown) {
    assertOk(
      'instagram: conexão expirada',
      await db
        .from('connections')
        .update({ status: 'expirada', last_error: errorMessage(error).slice(0, 2000) })
        .eq('id', conexaoId),
    );
  }

  async function lerPost(orgId: string, approvalId: string) {
    return unwrapMaybe(
      'post: ler',
      await db
        .from('social_posts')
        .select('*')
        .eq('org_id', orgId)
        .eq('approval_id', approvalId)
        .maybeSingle(),
    );
  }

  async function atualizarPost(id: string, campos: TablesUpdate<'social_posts'>) {
    assertOk('post: atualizar', await db.from('social_posts').update(campos).eq('id', id));
  }

  async function criarRascunho(
    orgId: string,
    taskId: string,
    approvalId: string,
    post: InstagramPostRequest,
  ) {
    assertOk(
      'post: rascunho',
      await db.from('social_posts').upsert(
        {
          org_id: orgId,
          task_id: taskId,
          approval_id: approvalId,
          format: post.formato,
          caption: post.legenda,
          media_ids: post.midia_ids,
          crop: post.recorte,
          scheduled_at: post.agendar_para ?? null,
        },
        { onConflict: 'approval_id', ignoreDuplicates: true },
      ),
    );
  }

  /** Espera o contêiner ficar pronto. Devolve o status final (ou IN_PROGRESS se estourou). */
  async function esperarContainer(
    api: InstagramApi,
    containerId: string,
    timeoutMs: number,
  ): Promise<{ status: ContainerStatus; detail: string | null }> {
    const limite = Date.now() + timeoutMs;
    for (;;) {
      const r = await api.containerStatus(containerId);
      if (r.status !== 'IN_PROGRESS' || Date.now() >= limite) return r;
      await sleep(POLL_MS);
    }
  }

  /** Sobe cada mídia (fotos já recortadas em JPEG) e devolve URLs assinadas, na ordem. */
  async function prepararMidias(orgId: string, approvalId: string, post: InstagramPostRequest) {
    const rows = unwrap(
      'post: mídias',
      await db.from('media_assets').select('*').eq('org_id', orgId).in('id', post.midia_ids),
    );
    const porId = new Map(rows.map((r) => [r.id, r]));
    const resultado: Array<{ kind: 'imagem' | 'video'; url: string }> = [];
    // No carrossel, o Instagram usa a proporção do primeiro item para todos.
    let aspectoCarrossel: number | null | undefined;

    for (const [indice, id] of post.midia_ids.entries()) {
      const asset = porId.get(id);
      if (!asset) throw new Error(`Mídia ${id} não encontrada.`);
      const video = asset.mime_type.startsWith('video/');
      let caminho = asset.storage_path;
      if (!video) {
        const baixada = await db.storage.from('midia').download(asset.storage_path);
        if (baixada.error) throw new RetryableActionError(`Storage: ${baixada.error.message}`);
        const bytes = new Uint8Array(await baixada.data.arrayBuffer());
        if (post.formato === 'carrossel' && aspectoCarrossel === undefined) {
          const w = asset.width ?? 0;
          const h = asset.height ?? 0;
          aspectoCarrossel = w && h ? targetAspect(post.recorte, 'carrossel', w / h) : null;
          if (post.recorte === 'original' && aspectoCarrossel === null && w && h) {
            aspectoCarrossel = w / h;
          }
        }
        const pronta = await prepareImage(bytes, {
          crop: post.recorte,
          format: post.formato,
          ...(post.formato === 'carrossel' && aspectoCarrossel !== undefined
            ? { aspect: aspectoCarrossel }
            : {}),
        });
        caminho = `${orgId}/instagram/${approvalId}/${indice + 1}.jpg`;
        const enviado = await db.storage
          .from('midia')
          .upload(caminho, pronta.data, { contentType: 'image/jpeg', upsert: true });
        if (enviado.error) throw new RetryableActionError(`Storage: ${enviado.error.message}`);
      }
      const assinada = await db.storage.from('midia').createSignedUrl(caminho, URL_VALIDADE_S);
      if (assinada.error) throw new RetryableActionError(`Storage: ${assinada.error.message}`);
      resultado.push({ kind: video ? 'video' : 'imagem', url: assinada.data.signedUrl });
    }
    return resultado;
  }

  async function criarContainer(
    api: InstagramApi,
    post: InstagramPostRequest,
    midias: Array<{ kind: 'imagem' | 'video'; url: string }>,
  ): Promise<{ id: string; temVideo: boolean }> {
    const legenda = post.legenda || undefined;
    const temVideo = midias.some((m) => m.kind === 'video');
    const [primeira] = midias;
    switch (post.formato) {
      case 'feed':
        return {
          id: await api.createImageContainer({ imageUrl: primeira!.url, caption: legenda }),
          temVideo,
        };
      case 'reels':
        return {
          id: await api.createVideoContainer({
            videoUrl: primeira!.url,
            kind: 'reels',
            caption: legenda,
          }),
          temVideo,
        };
      case 'story':
        return {
          id:
            primeira!.kind === 'video'
              ? await api.createVideoContainer({ videoUrl: primeira!.url, kind: 'story' })
              : await api.createImageContainer({ imageUrl: primeira!.url, story: true }),
          temVideo,
        };
      case 'carrossel': {
        const filhos: string[] = [];
        for (const m of midias) {
          filhos.push(
            m.kind === 'video'
              ? await api.createVideoContainer({ videoUrl: m.url, kind: 'carrossel' })
              : await api.createImageContainer({ imageUrl: m.url, carouselItem: true }),
          );
        }
        for (const filho of filhos) {
          const r = await esperarContainer(api, filho, temVideo ? timeouts.video : timeouts.imagem);
          if (r.status === 'IN_PROGRESS') {
            throw new RetryableActionError('O Instagram ainda está processando as mídias.');
          }
          if (r.status !== 'FINISHED') {
            throw new Error(
              `O Instagram recusou uma das mídias do carrossel: ${r.detail ?? r.status}`,
            );
          }
        }
        return {
          id: await api.createCarouselContainer({ children: filhos, caption: legenda }),
          temVideo,
        };
      }
    }
  }

  /**
   * O contêiner já foi publicado numa tentativa anterior (o processo caiu depois do publish):
   * procura o post entre os recentes pela legenda, para não publicar de novo.
   */
  async function recuperarPublicado(api: InstagramApi, legenda: string) {
    const recentes = await api.listMedia(10);
    return recentes.find((m) => (m.caption ?? '') === legenda) ?? null;
  }

  return {
    async account(orgId) {
      const c = await conexao(orgId);
      return c ? { username: c.username, igUserId: c.igUserId } : null;
    },

    async recentPosts(orgId, options) {
      const { api, conexao: c } = await cliente(orgId);
      let lista;
      try {
        lista = await api.listMedia(options.limit);
      } catch (error) {
        if (error instanceof InstagramError && error.tokenInvalid) {
          await marcarConexaoInvalida(c.id, error);
        }
        throw error;
      }
      const resumo: InstagramPostSummary[] = [];
      for (const m of lista) {
        const item: InstagramPostSummary = {
          id: m.id,
          tipo: m.productType ?? m.mediaType,
          legenda: m.caption,
          data: m.timestamp,
          link: m.permalink,
          curtidas: m.likeCount,
          comentarios: m.commentsCount,
        };
        if (options.withInsights) {
          // Posts antigos ou de tipos sem métricas falham individualmente: segue sem eles.
          item.metricas = await api.insights(m).catch(() => ({}));
        }
        resumo.push(item);
      }
      return resumo;
    },

    async saveDraft(input) {
      const ap = unwrap(
        'post: aprovação',
        await db
          .from('approvals')
          .select('payload, action_type')
          .eq('org_id', input.orgId)
          .eq('id', input.approvalId)
          .single(),
      );
      if (ap.action_type !== 'instagram.publicar') return;
      const post = instagramPostPayload.parse(ap.payload);
      await criarRascunho(input.orgId, input.taskId, input.approvalId, post);
    },

    async markScheduled(orgId, approvalId, at) {
      const atualizado = unwrap(
        'post: agendar',
        await db
          .from('social_posts')
          .update({ status: 'agendado', scheduled_at: at })
          .eq('org_id', orgId)
          .eq('approval_id', approvalId)
          .eq('status', 'aguardando_confirmacao')
          .select('id'),
      );
      return atualizado.length > 0;
    },

    async publish(input) {
      const { orgId, approvalId, post } = input;
      let row = await lerPost(orgId, approvalId);
      if (!row) {
        await criarRascunho(orgId, input.taskId, approvalId, post);
        row = await lerPost(orgId, approvalId);
      }
      if (!row) throw new Error('Post não encontrado.');
      if (row.status === 'publicado' && row.ig_media_id) {
        return { mediaId: row.ig_media_id, permalink: row.permalink };
      }
      if (row.status === 'cancelado') throw new Error('O post foi cancelado.');

      const { api, conexao: c } = await cliente(orgId);
      const postId = row.id;
      const falhar = async (error: unknown): Promise<never> => {
        if (error instanceof InstagramError && error.tokenInvalid) {
          await marcarConexaoInvalida(c.id, error);
          await atualizarPost(postId, {
            status: 'falhou',
            error: errorMessage(error).slice(0, 2000),
          });
          throw new Error(
            'O acesso ao Instagram expirou ou foi revogado. O dono precisa reconectar a conta no painel.',
          );
        }
        if (
          error instanceof RetryableActionError ||
          (error instanceof InstagramError && error.retryable)
        ) {
          throw error instanceof RetryableActionError
            ? error
            : new RetryableActionError(error.message);
        }
        await atualizarPost(postId, {
          status: 'falhou',
          error: errorMessage(error).slice(0, 2000),
        });
        throw error;
      };

      try {
        await atualizarPost(postId, { status: 'publicando', error: null });
        let containerId = row.ig_container_id;
        let temVideo = post.formato === 'reels';

        if (containerId) {
          const atual = await api.containerStatus(containerId);
          if (atual.status === 'PUBLISHED') {
            const achado = await recuperarPublicado(api, post.legenda);
            if (!achado) {
              throw new Error(
                'O Instagram indica que o post já foi publicado, mas não o encontrei no perfil. Confira antes de publicar de novo.',
              );
            }
            await atualizarPost(postId, {
              status: 'publicado',
              ig_media_id: achado.id,
              permalink: achado.permalink,
              published_at: new Date().toISOString(),
            });
            return { mediaId: achado.id, permalink: achado.permalink };
          }
          if (atual.status === 'ERROR' || atual.status === 'EXPIRED') containerId = null;
        }

        if (!containerId) {
          const limite = await api.publishingLimit();
          if (limite.used >= limite.total) {
            throw new RetryableActionError(
              `Limite de ${limite.total} publicações em 24h atingido; tento de novo mais tarde.`,
            );
          }
          const midias = await prepararMidias(orgId, approvalId, post);
          const criado = await criarContainer(api, post, midias);
          containerId = criado.id;
          temVideo = criado.temVideo;
          await atualizarPost(postId, { ig_container_id: containerId });
        }

        const pronto = await esperarContainer(
          api,
          containerId,
          temVideo ? timeouts.video : timeouts.imagem,
        );
        if (pronto.status === 'IN_PROGRESS') {
          throw new RetryableActionError('O Instagram ainda está processando a mídia.');
        }
        if (pronto.status !== 'FINISHED') {
          await atualizarPost(postId, { ig_container_id: null });
          throw new Error(`O Instagram recusou a mídia: ${pronto.detail ?? pronto.status}`);
        }

        const mediaId = await api.publish(containerId);
        const publicadoEm = new Date().toISOString();
        await atualizarPost(postId, {
          status: 'publicado',
          ig_media_id: mediaId,
          published_at: publicadoEm,
        });
        const permalink = await api
          .media(mediaId)
          .then((m) => m.permalink)
          .catch(() => null);
        if (permalink) await atualizarPost(postId, { permalink });
        return { mediaId, permalink };
      } catch (error) {
        return falhar(error);
      }
    },
  };
}

/**
 * Renova tokens que vencem nos próximos 15 dias (o token longo dura 60 e pode ser renovado
 * depois de 24h). Token recusado marca a conexão como expirada para o dono reconectar.
 */
export async function refreshInstagramTokens(
  db: TypedClient,
  options: { fetch?: typeof fetch; now?: Date } = {},
): Promise<{ renovados: number; expirados: number }> {
  const agora = options.now ?? new Date();
  const limite = new Date(agora.getTime() + 15 * 86_400_000).toISOString();
  const conexoes = unwrap(
    'instagram: conexões a renovar',
    await db
      .from('connections')
      .select('id, expires_at, updated_at')
      .eq('provider', 'instagram')
      .eq('status', 'ativa')
      .lt('expires_at', limite),
  );
  let renovados = 0;
  let expirados = 0;
  for (const c of conexoes) {
    if (agora.getTime() - new Date(c.updated_at).getTime() < 24 * 3_600_000) continue;
    const token = await db.rpc('connection_secret_get', { p_connection_id: c.id });
    if (token.error || !token.data) continue;
    try {
      const novo = await refreshInstagramToken(
        token.data,
        options.fetch ? { fetch: options.fetch } : {},
      );
      assertOk(
        'instagram: salvar token',
        await db.rpc('connection_secret_set', {
          p_connection_id: c.id,
          p_secret: novo.accessToken,
        }),
      );
      assertOk(
        'instagram: validade',
        await db
          .from('connections')
          .update({
            expires_at: new Date(agora.getTime() + novo.expiresIn * 1000).toISOString(),
            last_error: null,
          })
          .eq('id', c.id),
      );
      renovados += 1;
    } catch (error) {
      if (error instanceof InstagramError && !error.retryable) {
        assertOk(
          'instagram: expirar conexão',
          await db
            .from('connections')
            .update({ status: 'expirada', last_error: errorMessage(error).slice(0, 2000) })
            .eq('id', c.id),
        );
        expirados += 1;
      }
    }
  }
  return { renovados, expirados };
}
