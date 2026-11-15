'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ORG_COOKIE, requirePanelSession } from '@/lib/session';

/** Troca a empresa ativa no painel (só entre as empresas de que o usuário é membro). */
export async function switchOrg(formData: FormData) {
  const session = await requirePanelSession();
  const orgId = String(formData.get('org') ?? '');
  if (session.orgs.some((o) => o.id === orgId)) {
    (await cookies()).set(ORG_COOKIE, orgId, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: true,
    });
  }
  redirect('/');
}
