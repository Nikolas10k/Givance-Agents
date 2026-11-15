'use server';

import { headers } from 'next/headers';
import { publicEnv } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';

export interface LoginState {
  status: 'inicial' | 'enviado' | 'erro';
  email?: string;
  message?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Envia o link mágico. Só funciona para contas já criadas pela Givance. */
export async function sendMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  if (!EMAIL.test(email)) {
    return {
      status: 'erro',
      email,
      message: 'Confira o e-mail: ele precisa ter o formato nome@empresa.com.br.',
    };
  }

  const origin = (await headers()).get('origin') ?? publicEnv().siteUrl;
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: `${origin}/auth/callback` },
  });

  // Mesmo retorno para conta existente ou não: não revelamos quem tem acesso.
  if (error && error.status !== 400 && error.status !== 422) {
    return {
      status: 'erro',
      email,
      message: 'Não conseguimos enviar o link agora. Tente de novo em alguns minutos.',
    };
  }
  return { status: 'enviado', email };
}
