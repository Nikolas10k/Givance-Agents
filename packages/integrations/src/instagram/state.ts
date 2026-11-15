import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * "state" do OAuth: amarra o retorno do login à empresa, ao usuário e ao navegador que
 * começou o fluxo (o nonce também vai num cookie httpOnly). Assinado com HMAC e com validade
 * curta, para ninguém ligar a conta do Instagram de outra pessoa na sua empresa.
 */
export interface OAuthState {
  orgId: string;
  userId: string;
  nonce: string;
  /** Epoch em segundos. */
  exp: number;
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(`givance-oauth-state:${payload}`).digest('base64url');
}

export function createOAuthState(
  input: { orgId: string; userId: string },
  secret: string,
  now = Date.now(),
  ttlSeconds = 600,
): { state: string; nonce: string } {
  const nonce = randomBytes(16).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ ...input, nonce, exp: Math.floor(now / 1000) + ttlSeconds }),
  ).toString('base64url');
  return { state: `${payload}.${sign(payload, secret)}`, nonce };
}

/** Devolve o conteúdo do state se a assinatura, a validade e o nonce do cookie conferirem. */
export function verifyOAuthState(
  state: string,
  cookieNonce: string | undefined,
  secret: string,
  now = Date.now(),
): OAuthState | null {
  const [payload, assinatura] = state.split('.');
  if (!payload || !assinatura || !cookieNonce) return null;
  const esperada = Buffer.from(sign(payload, secret));
  const recebida = Buffer.from(assinatura);
  if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) return null;
  let parsed: OAuthState;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as OAuthState;
  } catch {
    return null;
  }
  if (typeof parsed.exp !== 'number' || parsed.exp * 1000 < now) return null;
  if (parsed.nonce !== cookieNonce) return null;
  if (typeof parsed.orgId !== 'string' || typeof parsed.userId !== 'string') return null;
  return parsed;
}
