/**
 * Cliente mínimo da API do Instagram com login do Instagram (graph.instagram.com).
 * Cobre o que a Fase 1c usa: OAuth da conta profissional, publicação (foto, carrossel, reels,
 * story), status do contêiner, posts recentes, métricas e limite de publicações em 24h.
 *
 * A API não agenda posts: quem segura o horário é o worker.
 */

export interface InstagramOAuthConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
  graphVersion?: string;
  fetch?: typeof fetch;
}

export interface InstagramClientConfig {
  accessToken: string;
  /** ID da conta profissional (user_id devolvido no login). */
  igUserId: string;
  graphVersion?: string;
  fetch?: typeof fetch;
  baseUrl?: string;
}

/** Permissões pedidas no login. Mensagens (Direct) entram na 1d. */
export const INSTAGRAM_SCOPES = [
  'instagram_business_basic',
  'instagram_business_content_publish',
] as const;

export const DEFAULT_INSTAGRAM_GRAPH_VERSION = 'v23.0';

/** Códigos de erro da Graph API que tratamos de forma específica. */
const CODIGOS_TEMPORARIOS = new Set([1, 2, 4, 17, 32, 341, 613, 80001]);
const TOKEN_INVALIDO = 190;

export class InstagramError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: number | undefined,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'InstagramError';
  }

  /** Token expirado ou revogado: a conexão precisa ser refeita pelo dono. */
  get tokenInvalid(): boolean {
    return this.code === TOKEN_INVALIDO;
  }
}

interface GraphErrorBody {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
    is_transient?: boolean;
    error_user_msg?: string;
  };
  error_type?: string;
  error_message?: string;
  code?: number;
}

async function call(doFetch: typeof fetch, url: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await doFetch(url, init);
  } catch (error) {
    throw new InstagramError(
      `Falha de rede ao falar com o Instagram: ${String(error)}`,
      0,
      undefined,
      true,
    );
  }
  const body = (await response.json().catch(() => ({}))) as GraphErrorBody;
  if (!response.ok || body.error || body.error_type) {
    const code = body.error?.code ?? body.code;
    const retryable =
      response.status === 429 ||
      response.status >= 500 ||
      body.error?.is_transient === true ||
      (code !== undefined && CODIGOS_TEMPORARIOS.has(code));
    const detalhe =
      body.error?.error_user_msg ?? body.error?.message ?? body.error_message ?? 'sem detalhes';
    throw new InstagramError(
      `Instagram recusou o pedido (${response.status}${code ? `, código ${code}` : ''}): ${detalhe}`,
      response.status,
      code,
      retryable,
    );
  }
  return body;
}

function withParams(url: string, params: Record<string, string | number | undefined>): string {
  const u = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) u.searchParams.set(key, String(value));
  }
  return u.toString();
}

function formBody(params: Record<string, string | number | boolean | undefined>): URLSearchParams {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) body.set(key, String(value));
  }
  return body;
}

export interface InstagramToken {
  accessToken: string;
  /** Segundos até expirar (token longo: cerca de 60 dias). */
  expiresIn: number;
}

export interface InstagramProfile {
  igUserId: string;
  username: string;
  accountType: string | null;
  name: string | null;
  profilePictureUrl: string | null;
}

/** Login do Instagram (Business Login). Tudo aqui roda no servidor: usa o segredo do app. */
export function createInstagramOAuth(config: InstagramOAuthConfig) {
  const doFetch = config.fetch ?? fetch;
  const version = config.graphVersion ?? DEFAULT_INSTAGRAM_GRAPH_VERSION;

  return {
    authorizeUrl(state: string, scopes: readonly string[] = INSTAGRAM_SCOPES): string {
      return withParams('https://www.instagram.com/oauth/authorize', {
        enable_fb_login: 0,
        force_authentication: 1,
        client_id: config.appId,
        redirect_uri: config.redirectUri,
        response_type: 'code',
        scope: scopes.join(','),
        state,
      });
    },

    /** Código do retorno -> token curto (1h) + id da conta e permissões concedidas. */
    async exchangeCode(
      code: string,
    ): Promise<{ accessToken: string; igUserId: string; permissions: string[] }> {
      const body = (await call(doFetch, 'https://api.instagram.com/oauth/access_token', {
        method: 'POST',
        body: formBody({
          client_id: config.appId,
          client_secret: config.appSecret,
          grant_type: 'authorization_code',
          redirect_uri: config.redirectUri,
          code: code.replace(/#_$/, ''),
        }),
      })) as {
        data?: Array<{ access_token: string; user_id: string | number; permissions?: string }>;
        access_token?: string;
        user_id?: string | number;
        permissions?: string | string[];
      };
      const item = body.data?.[0] ?? body;
      if (!item.access_token || item.user_id === undefined) {
        throw new InstagramError(
          'Resposta do login do Instagram sem token.',
          200,
          undefined,
          false,
        );
      }
      const permissions = Array.isArray(item.permissions)
        ? item.permissions
        : (item.permissions ?? '').split(',').filter(Boolean);
      return {
        accessToken: item.access_token,
        igUserId: String(item.user_id),
        permissions: permissions.map((p) => p.trim()),
      };
    },

    /** Token curto -> token longo (60 dias). */
    async longLived(shortToken: string): Promise<InstagramToken> {
      const body = (await call(
        doFetch,
        withParams('https://graph.instagram.com/access_token', {
          grant_type: 'ig_exchange_token',
          client_secret: config.appSecret,
          access_token: shortToken,
        }),
      )) as { access_token: string; expires_in: number };
      return { accessToken: body.access_token, expiresIn: body.expires_in };
    },

    async profile(accessToken: string): Promise<InstagramProfile> {
      return fetchProfile(doFetch, version, accessToken);
    },
  };
}

async function fetchProfile(
  doFetch: typeof fetch,
  version: string,
  accessToken: string,
  baseUrl = 'https://graph.instagram.com',
): Promise<InstagramProfile> {
  const body = (await call(
    doFetch,
    withParams(`${baseUrl}/${version}/me`, {
      fields: 'user_id,username,account_type,name,profile_picture_url',
      access_token: accessToken,
    }),
  )) as {
    user_id?: string | number;
    id?: string;
    username: string;
    account_type?: string;
    name?: string;
    profile_picture_url?: string;
  };
  return {
    igUserId: String(body.user_id ?? body.id),
    username: body.username,
    accountType: body.account_type ?? null,
    name: body.name ?? null,
    profilePictureUrl: body.profile_picture_url ?? null,
  };
}

/** Renova um token longo por mais 60 dias (precisa ter pelo menos 24h). Não usa o segredo. */
export async function refreshInstagramToken(
  accessToken: string,
  options: { fetch?: typeof fetch; baseUrl?: string } = {},
): Promise<InstagramToken> {
  const body = (await call(
    options.fetch ?? fetch,
    withParams(`${options.baseUrl ?? 'https://graph.instagram.com'}/refresh_access_token`, {
      grant_type: 'ig_refresh_token',
      access_token: accessToken,
    }),
  )) as { access_token: string; expires_in: number };
  return { accessToken: body.access_token, expiresIn: body.expires_in };
}

export type ContainerStatus = 'EXPIRED' | 'ERROR' | 'FINISHED' | 'IN_PROGRESS' | 'PUBLISHED';

export interface InstagramMedia {
  id: string;
  caption: string | null;
  mediaType: string;
  productType: string | null;
  permalink: string | null;
  timestamp: string | null;
  likeCount: number | null;
  commentsCount: number | null;
}

export type InstagramInsights = Partial<
  Record<
    'reach' | 'likes' | 'comments' | 'saved' | 'shares' | 'views' | 'total_interactions',
    number
  >
>;

export function createInstagramClient(config: InstagramClientConfig) {
  const doFetch = config.fetch ?? fetch;
  const base = `${config.baseUrl ?? 'https://graph.instagram.com'}/${config.graphVersion ?? DEFAULT_INSTAGRAM_GRAPH_VERSION}`;
  const token = config.accessToken;

  const get = (path: string, params: Record<string, string | number | undefined> = {}) =>
    call(doFetch, withParams(`${base}/${path}`, { ...params, access_token: token }));

  const post = (path: string, params: Record<string, string | number | boolean | undefined>) =>
    call(doFetch, `${base}/${path}`, {
      method: 'POST',
      body: formBody({ ...params, access_token: token }),
    });

  async function createContainer(
    params: Record<string, string | number | boolean | undefined>,
  ): Promise<string> {
    const body = (await post(`${config.igUserId}/media`, params)) as { id: string };
    return body.id;
  }

  return {
    profile(): Promise<InstagramProfile> {
      return fetchProfile(
        doFetch,
        config.graphVersion ?? DEFAULT_INSTAGRAM_GRAPH_VERSION,
        token,
        config.baseUrl,
      );
    },

    /** Foto de feed, item de carrossel ou story de foto. A imagem precisa estar numa URL pública. */
    createImageContainer(input: {
      imageUrl: string;
      caption?: string;
      carouselItem?: boolean;
      story?: boolean;
    }): Promise<string> {
      return createContainer({
        image_url: input.imageUrl,
        caption: input.carouselItem || input.story ? undefined : input.caption,
        is_carousel_item: input.carouselItem ? true : undefined,
        media_type: input.story ? 'STORIES' : undefined,
      });
    },

    /** Reels, item de vídeo de carrossel ou story de vídeo. */
    createVideoContainer(input: {
      videoUrl: string;
      kind: 'reels' | 'story' | 'carrossel';
      caption?: string;
      shareToFeed?: boolean;
    }): Promise<string> {
      const mediaType = { reels: 'REELS', story: 'STORIES', carrossel: 'VIDEO' }[input.kind];
      return createContainer({
        video_url: input.videoUrl,
        media_type: mediaType,
        caption: input.kind === 'reels' ? input.caption : undefined,
        share_to_feed: input.kind === 'reels' ? (input.shareToFeed ?? true) : undefined,
        is_carousel_item: input.kind === 'carrossel' ? true : undefined,
      });
    },

    createCarouselContainer(input: { children: string[]; caption?: string }): Promise<string> {
      return createContainer({
        media_type: 'CAROUSEL',
        children: input.children.join(','),
        caption: input.caption,
      });
    },

    async containerStatus(
      containerId: string,
    ): Promise<{ status: ContainerStatus; detail: string | null }> {
      const body = (await get(containerId, { fields: 'status_code,status' })) as {
        status_code: ContainerStatus;
        status?: string;
      };
      return { status: body.status_code, detail: body.status ?? null };
    },

    /** Publica um contêiner pronto. Devolve o id da mídia publicada. */
    async publish(containerId: string): Promise<string> {
      const body = (await post(`${config.igUserId}/media_publish`, {
        creation_id: containerId,
      })) as { id: string };
      return body.id;
    },

    async media(mediaId: string): Promise<InstagramMedia> {
      const body = (await get(mediaId, {
        fields:
          'id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count',
      })) as RawMedia;
      return toMedia(body);
    },

    async listMedia(limit = 12): Promise<InstagramMedia[]> {
      const body = (await get(`${config.igUserId}/media`, {
        fields:
          'id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count',
        limit: Math.min(Math.max(limit, 1), 50),
      })) as { data?: RawMedia[] };
      return (body.data ?? []).map(toMedia);
    },

    /** Métricas de um post. Métricas que não valem para o tipo do post ficam de fora. */
    async insights(media: Pick<InstagramMedia, 'id' | 'productType'>): Promise<InstagramInsights> {
      const metricas =
        media.productType === 'STORY'
          ? ['reach', 'views', 'shares', 'total_interactions']
          : ['reach', 'likes', 'comments', 'saved', 'shares', 'views', 'total_interactions'];
      const body = (await get(`${media.id}/insights`, { metric: metricas.join(',') })) as {
        data?: Array<{
          name: string;
          values?: Array<{ value: number }>;
          total_value?: { value: number };
        }>;
      };
      const out: InstagramInsights = {};
      for (const item of body.data ?? []) {
        const valor = item.total_value?.value ?? item.values?.[0]?.value;
        if (typeof valor === 'number') out[item.name as keyof InstagramInsights] = valor;
      }
      return out;
    },

    /** Publicações usadas nas últimas 24h e o limite da conta. */
    async publishingLimit(): Promise<{ used: number; total: number }> {
      const body = (await get(`${config.igUserId}/content_publishing_limit`, {
        fields: 'quota_usage,config',
      })) as { data?: Array<{ quota_usage?: number; config?: { quota_total?: number } }> };
      const item = body.data?.[0];
      return { used: item?.quota_usage ?? 0, total: item?.config?.quota_total ?? 100 };
    },
  };
}

interface RawMedia {
  id: string;
  caption?: string;
  media_type: string;
  media_product_type?: string;
  permalink?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
}

function toMedia(raw: RawMedia): InstagramMedia {
  return {
    id: raw.id,
    caption: raw.caption ?? null,
    mediaType: raw.media_type,
    productType: raw.media_product_type ?? null,
    permalink: raw.permalink ?? null,
    timestamp: raw.timestamp ?? null,
    likeCount: raw.like_count ?? null,
    commentsCount: raw.comments_count ?? null,
  };
}

export type InstagramClient = ReturnType<typeof createInstagramClient>;
export type InstagramOAuth = ReturnType<typeof createInstagramOAuth>;
