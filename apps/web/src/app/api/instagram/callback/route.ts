import { errorMessage } from '@givance/core';
import { verifyOAuthState } from '@givance/integrations';
import { NextResponse, type NextRequest } from 'next/server';
import { publicEnv } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import { IG_NONCE_COOKIE, instagramOAuth, podeConectar } from '@/server/instagram';
import { serviceClient } from '@/server/service';

/**
 * Retorno do login do Instagram: confere o state (empresa, usuário e navegador), troca o código
 * por um token longo e grava a conexão. O token vai direto para o Vault.
 */
export async function GET(request: NextRequest) {
  const base = publicEnv().siteUrl;
  const voltar = (query: string) => {
    const response = NextResponse.redirect(`${base}/instagram?${query}`);
    response.cookies.delete({ name: IG_NONCE_COOKIE, path: '/api/instagram' });
    return response;
  };

  const ig = instagramOAuth();
  if (!ig) return voltar('erro=nao-configurado');

  const params = request.nextUrl.searchParams;
  if (params.get('error')) return voltar('erro=cancelado');
  const code = params.get('code');
  const state = verifyOAuthState(
    params.get('state') ?? '',
    request.cookies.get(IG_NONCE_COOKIE)?.value,
    ig.stateSecret,
  );
  if (!code || !state) return voltar('erro=sessao');

  // Quem volta do login tem que ser quem começou, e ainda poder conectar nesta empresa.
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (claims?.claims?.sub !== state.userId) return voltar('erro=sessao');
  const { data: membro } = await supabase
    .from('memberships')
    .select('role')
    .eq('org_id', state.orgId)
    .eq('user_id', state.userId)
    .maybeSingle();
  if (!membro || !podeConectar(membro.role)) return voltar('erro=permissao');

  try {
    const curto = await ig.oauth.exchangeCode(code);
    if (!curto.permissions.includes('instagram_business_content_publish')) {
      return voltar('erro=permissoes');
    }
    const longo = await ig.oauth.longLived(curto.accessToken);
    const perfil = await ig.oauth.profile(longo.accessToken);

    const db = serviceClient();
    const { data: conexao, error } = await db
      .from('connections')
      .upsert(
        {
          org_id: state.orgId,
          provider: 'instagram',
          label: 'principal',
          external_ids: {
            ig_user_id: perfil.igUserId || curto.igUserId,
            username: perfil.username,
            account_type: perfil.accountType,
            name: perfil.name,
          },
          scopes: curto.permissions,
          status: 'ativa',
          expires_at: new Date(Date.now() + longo.expiresIn * 1000).toISOString(),
          last_error: null,
        },
        { onConflict: 'org_id,provider,label' },
      )
      .select('id')
      .single();
    if (error || !conexao) throw new Error(error?.message ?? 'conexão não gravada');
    const segredo = await db.rpc('connection_secret_set', {
      p_connection_id: conexao.id,
      p_secret: longo.accessToken,
    });
    if (segredo.error) throw new Error(segredo.error.message);
    await db.from('audit_log').insert({
      org_id: state.orgId,
      actor_type: 'usuario',
      actor_id: state.userId,
      action: 'conexao.instagram_conectada',
      target: `connection:${conexao.id}`,
      payload_redacted: { username: perfil.username, permissoes: curto.permissions },
    });
    return voltar('ok=1');
  } catch (error) {
    console.error('Falha ao conectar o Instagram', errorMessage(error));
    return voltar('erro=falha');
  }
}
