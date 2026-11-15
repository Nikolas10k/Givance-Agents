import { describe, expect, it } from 'vitest';
import {
  createInstagramClient,
  createInstagramOAuth,
  InstagramError,
  refreshInstagramToken,
} from './client';
import { createOAuthState, verifyOAuthState } from './state';

function fakeFetch(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = responses.shift() ?? { body: {} };
    return {
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      json: async () => r.body,
    } as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const bodyOf = (init?: RequestInit) => Object.fromEntries(new URLSearchParams(String(init?.body)));

describe('login do Instagram', () => {
  const base = { appId: '111', appSecret: 'segredo-do-app', redirectUri: 'https://x.test/cb' };

  it('monta a URL de autorização com escopos e state', () => {
    const url = new URL(createInstagramOAuth(base).authorizeUrl('st4te'));
    expect(url.origin + url.pathname).toBe('https://www.instagram.com/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: '111',
      redirect_uri: 'https://x.test/cb',
      response_type: 'code',
      scope: 'instagram_business_basic,instagram_business_content_publish',
      state: 'st4te',
    });
  });

  it('troca o código (tirando o #_ do fim) e depois pelo token longo', async () => {
    const { fn, calls } = fakeFetch([
      {
        body: {
          data: [
            {
              access_token: 'curto',
              user_id: 1789,
              permissions: 'instagram_business_basic,instagram_business_content_publish',
            },
          ],
        },
      },
      { body: { access_token: 'longo', token_type: 'bearer', expires_in: 5183944 } },
    ]);
    const oauth = createInstagramOAuth({ ...base, fetch: fn });
    const curto = await oauth.exchangeCode('AQB#_');
    expect(curto).toEqual({
      accessToken: 'curto',
      igUserId: '1789',
      permissions: ['instagram_business_basic', 'instagram_business_content_publish'],
    });
    expect(bodyOf(calls[0]!.init)).toMatchObject({ code: 'AQB', grant_type: 'authorization_code' });
    const longo = await oauth.longLived('curto');
    expect(longo).toEqual({ accessToken: 'longo', expiresIn: 5183944 });
    expect(new URL(calls[1]!.url).searchParams.get('grant_type')).toBe('ig_exchange_token');
  });

  it('renova o token longo', async () => {
    const { fn, calls } = fakeFetch([{ body: { access_token: 'novo', expires_in: 100 } }]);
    expect(await refreshInstagramToken('velho', { fetch: fn })).toEqual({
      accessToken: 'novo',
      expiresIn: 100,
    });
    expect(calls[0]!.url).toContain('refresh_access_token?grant_type=ig_refresh_token');
  });
});

describe('state do OAuth', () => {
  const segredo = 'segredo-de-teste';

  it('aceita o state assinado com o nonce do cookie', () => {
    const { state, nonce } = createOAuthState({ orgId: 'o1', userId: 'u1' }, segredo);
    expect(verifyOAuthState(state, nonce, segredo)).toMatchObject({ orgId: 'o1', userId: 'u1' });
  });

  it('recusa state adulterado, vencido, de outro navegador ou com outro segredo', () => {
    const agora = Date.now();
    const { state, nonce } = createOAuthState({ orgId: 'o1', userId: 'u1' }, segredo, agora);
    const [payload, sig] = state.split('.');
    const adulterado = `${Buffer.from(
      JSON.stringify({ orgId: 'o2', userId: 'u1', nonce, exp: 9e9 }),
    ).toString('base64url')}.${sig}`;
    expect(verifyOAuthState(adulterado, nonce, segredo)).toBeNull();
    expect(verifyOAuthState(state, nonce, segredo, agora + 11 * 60_000)).toBeNull();
    expect(verifyOAuthState(state, 'outro-nonce', segredo)).toBeNull();
    expect(verifyOAuthState(state, undefined, segredo)).toBeNull();
    expect(verifyOAuthState(state, nonce, 'outro-segredo')).toBeNull();
    expect(verifyOAuthState(`${payload}`, nonce, segredo)).toBeNull();
  });
});

describe('cliente Instagram', () => {
  const cfg = { accessToken: 'tok', igUserId: '1789', graphVersion: 'v23.0' };

  it('carrossel: itens sem legenda, contêiner pai com legenda, depois publica', async () => {
    const { fn, calls } = fakeFetch([
      { body: { id: 'c1' } },
      { body: { id: 'c2' } },
      { body: { id: 'pai' } },
      { body: { status_code: 'FINISHED' } },
      { body: { id: 'midia-1' } },
    ]);
    const ig = createInstagramClient({ ...cfg, fetch: fn });
    const c1 = await ig.createImageContainer({
      imageUrl: 'https://cdn.test/1.jpg',
      caption: 'não vai',
      carouselItem: true,
    });
    const c2 = await ig.createVideoContainer({
      videoUrl: 'https://cdn.test/2.mp4',
      kind: 'carrossel',
    });
    const pai = await ig.createCarouselContainer({ children: [c1, c2], caption: 'Legenda' });
    expect(await ig.containerStatus(pai)).toEqual({ status: 'FINISHED', detail: null });
    expect(await ig.publish(pai)).toBe('midia-1');

    expect(calls[0]!.url).toBe('https://graph.instagram.com/v23.0/1789/media');
    expect(bodyOf(calls[0]!.init)).toEqual({
      image_url: 'https://cdn.test/1.jpg',
      is_carousel_item: 'true',
      access_token: 'tok',
    });
    expect(bodyOf(calls[1]!.init)).toMatchObject({ media_type: 'VIDEO', is_carousel_item: 'true' });
    expect(bodyOf(calls[2]!.init)).toMatchObject({
      media_type: 'CAROUSEL',
      children: 'c1,c2',
      caption: 'Legenda',
    });
    expect(calls[3]!.url).toContain('/pai?fields=status_code%2Cstatus');
    expect(bodyOf(calls[4]!.init)).toMatchObject({ creation_id: 'pai' });
  });

  it('reels vai para o feed também; story de foto não leva legenda', async () => {
    const { fn, calls } = fakeFetch([{ body: { id: 'r' } }, { body: { id: 's' } }]);
    const ig = createInstagramClient({ ...cfg, fetch: fn });
    await ig.createVideoContainer({
      videoUrl: 'https://cdn.test/v.mp4',
      kind: 'reels',
      caption: 'Oi',
    });
    await ig.createImageContainer({
      imageUrl: 'https://cdn.test/s.jpg',
      caption: 'x',
      story: true,
    });
    expect(bodyOf(calls[0]!.init)).toMatchObject({
      media_type: 'REELS',
      caption: 'Oi',
      share_to_feed: 'true',
    });
    expect(bodyOf(calls[1]!.init)).toEqual({
      image_url: 'https://cdn.test/s.jpg',
      media_type: 'STORIES',
      access_token: 'tok',
    });
  });

  it('lê posts, métricas e limite de publicações', async () => {
    const { fn } = fakeFetch([
      {
        body: {
          data: [
            {
              id: 'm1',
              caption: 'Promo',
              media_type: 'IMAGE',
              media_product_type: 'FEED',
              permalink: 'https://instagram.com/p/x',
              like_count: 10,
            },
          ],
        },
      },
      {
        body: {
          data: [
            { name: 'reach', values: [{ value: 300 }] },
            { name: 'saved', total_value: { value: 4 } },
          ],
        },
      },
      { body: { data: [{ quota_usage: 3, config: { quota_total: 100 } }] } },
    ]);
    const ig = createInstagramClient({ ...cfg, fetch: fn });
    const [post] = await ig.listMedia(5);
    expect(post).toMatchObject({ id: 'm1', likeCount: 10, commentsCount: null });
    expect(await ig.insights(post!)).toEqual({ reach: 300, saved: 4 });
    expect(await ig.publishingLimit()).toEqual({ used: 3, total: 100 });
  });

  it('classifica erros: limite é temporário, token inválido não', async () => {
    const { fn } = fakeFetch([
      { status: 400, body: { error: { message: 'Application request limit reached', code: 4 } } },
      { status: 400, body: { error: { message: 'Session has expired', code: 190 } } },
    ]);
    const ig = createInstagramClient({ ...cfg, fetch: fn });
    const limite = await ig.publish('x').catch((e: unknown) => e);
    expect(limite).toBeInstanceOf(InstagramError);
    expect((limite as InstagramError).retryable).toBe(true);
    const token = (await ig.publish('x').catch((e: unknown) => e)) as InstagramError;
    expect([token.retryable, token.tokenInvalid]).toEqual([false, true]);
  });
});
