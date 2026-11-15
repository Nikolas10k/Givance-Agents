import type { NextRequest } from 'next/server';
import { updateSession } from './lib/supabase/proxy';

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Tudo, menos arquivos estáticos, imagens e o webhook do WhatsApp (autenticado por assinatura).
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/whatsapp/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
