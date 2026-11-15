'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@givance/db';

/** Cliente do navegador (chave publicável + sessão do usuário). Usado para enviar arquivos. */
export function createBrowserSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Supabase não configurado no painel.');
  return createBrowserClient<Database>(url, key);
}
