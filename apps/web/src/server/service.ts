import 'server-only';
import { createServiceClient } from '@givance/db/service';

/** Cliente com chave secreta, só para rotas de servidor que não têm sessão de usuário (webhooks). */
export function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    throw new Error(
      'Configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SECRET_KEY no servidor do painel.',
    );
  }
  return createServiceClient({ url, secretKey });
}
