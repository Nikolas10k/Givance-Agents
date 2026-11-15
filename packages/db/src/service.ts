import { createClient } from '@supabase/supabase-js';
import type { TypedClient } from './client';
import type { Database } from './database.types';

/**
 * Cliente com a chave secreta (sb_secret_... ou a service_role antiga). Ignora o RLS:
 * use só no worker e no código de servidor do painel, sempre pelos repositórios, que exigem
 * org_id em toda consulta.
 */
export function createServiceClient(config: { url: string; secretKey: string }): TypedClient {
  return createClient<Database>(config.url, config.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'x-client-info': 'givance-worker' } },
  });
}

export type { TypedClient as ServiceClient };
