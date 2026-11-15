import 'server-only';
import { createInstagramOAuth } from '@givance/integrations';
import { publicEnv } from '@/lib/env';

export const IG_NONCE_COOKIE = 'givance_ig_nonce';

/** Login do Instagram do painel. Null quando o app da Meta ainda não foi configurado. */
export function instagramOAuth() {
  const appId = process.env.INSTAGRAM_APP_ID;
  const appSecret = process.env.INSTAGRAM_APP_SECRET;
  if (!appId || !appSecret) return null;
  return {
    oauth: createInstagramOAuth({
      appId,
      appSecret,
      redirectUri: `${publicEnv().siteUrl}/api/instagram/callback`,
      ...(process.env.INSTAGRAM_GRAPH_VERSION
        ? { graphVersion: process.env.INSTAGRAM_GRAPH_VERSION }
        : {}),
    }),
    /** Chave do HMAC do "state": derivada do segredo do app, nunca sai do servidor. */
    stateSecret: appSecret,
  };
}

export function podeConectar(role: string): boolean {
  return role === 'owner' || role === 'admin';
}
