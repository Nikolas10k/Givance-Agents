'use server';

import { requirePanelSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';

export interface VerificacaoState {
  status: 'inicial' | 'codigo' | 'erro';
  codigo?: string;
  message?: string;
}

/** Gera o código que o dono envia pelo WhatsApp para provar que o número é dele. */
export async function gerarCodigo(
  _prev: VerificacaoState,
  formData: FormData,
): Promise<VerificacaoState> {
  const session = await requirePanelSession();
  const numero = String(formData.get('numero') ?? '').trim();
  if (numero.replace(/\D/g, '').length < 10) {
    return { status: 'erro', message: 'Informe o número com DDD, ex.: (19) 99999-0000.' };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('start_channel_verification', {
    p_org_id: session.org.id,
    p_address: numero,
  });
  if (error || !data) {
    return {
      status: 'erro',
      message: error?.message ?? 'Não foi possível gerar o código agora. Tente de novo.',
    };
  }
  return { status: 'codigo', codigo: data };
}
