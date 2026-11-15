import { createServerClient } from '@supabase/ssr';
import type { Database } from '@givance/db';
import { cookies } from 'next/headers';
import { publicEnv } from '../env';

/**
 * Cliente do Supabase para Server Components, Server Actions e Route Handlers, com a sessão
 * do usuário (chave publicável + JWT). Tudo que ele lê passa pelo RLS.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const { url, publishableKey } = publicEnv();
  return createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components não podem gravar cookies; o proxy renova a sessão a cada pedido.
        }
      },
    },
  });
}
