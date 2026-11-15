import { createOAuthState } from '@givance/integrations';
import { NextResponse } from 'next/server';
import { publicEnv } from '@/lib/env';
import { requirePanelSession } from '@/lib/session';
import { IG_NONCE_COOKIE, instagramOAuth, podeConectar } from '@/server/instagram';

/** Começa o login do Instagram para a empresa selecionada no painel. */
export async function GET() {
  const session = await requirePanelSession();
  const base = publicEnv().siteUrl;
  if (!podeConectar(session.org.role)) {
    return NextResponse.redirect(`${base}/instagram?erro=permissao`);
  }
  const ig = instagramOAuth();
  if (!ig) {
    return NextResponse.redirect(`${base}/instagram?erro=nao-configurado`);
  }
  const { state, nonce } = createOAuthState(
    { orgId: session.org.id, userId: session.userId },
    ig.stateSecret,
  );
  const response = NextResponse.redirect(ig.oauth.authorizeUrl(state));
  response.cookies.set(IG_NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: base.startsWith('https://'),
    sameSite: 'lax',
    path: '/api/instagram',
    maxAge: 600,
  });
  return response;
}
