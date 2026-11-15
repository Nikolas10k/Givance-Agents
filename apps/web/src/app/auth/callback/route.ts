import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/** Volta do link mágico: troca o código pela sessão e segue para o painel. */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get('code');
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL('/', url.origin));
    }
  }
  const destino = new URL('/entrar', url.origin);
  destino.searchParams.set('erro', 'link');
  return NextResponse.redirect(destino);
}
