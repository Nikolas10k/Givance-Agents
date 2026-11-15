import { createServerClient } from '@supabase/ssr';
import type { Database } from '@givance/db';
import { NextResponse, type NextRequest } from 'next/server';
import { publicEnv } from '../env';

const PUBLIC_PATHS = ['/entrar', '/auth/callback'];

/**
 * Renova o token da sessão a cada pedido e manda quem não está logado para /entrar.
 * Devolve sempre a resposta montada pelo setAll, que carrega os cookies renovados.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, publishableKey } = publicEnv();

  const supabase = createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet)
          response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const logged = Boolean(data?.claims?.sub);
  const isPublic = PUBLIC_PATHS.some((p) => request.nextUrl.pathname.startsWith(p));

  if (!logged && !isPublic) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = '/entrar';
    redirect.search = '';
    const redirectResponse = NextResponse.redirect(redirect);
    for (const cookie of response.cookies.getAll()) redirectResponse.cookies.set(cookie);
    return redirectResponse;
  }
  return response;
}
