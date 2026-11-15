import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from './supabase/server';

export const ORG_COOKIE = 'givance_org';

export interface PanelSession {
  userId: string;
  email: string;
  org: { id: string; name: string; slug: string; timezone: string; role: string };
  orgs: Array<{ id: string; name: string; role: string }>;
}

/** Sessão do painel: usuário logado e empresa selecionada (cookie ou a primeira). */
export async function requirePanelSession(): Promise<PanelSession> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) {
    redirect('/entrar');
  }

  const { data: memberships } = await supabase
    .from('memberships')
    .select('role, organizations(id, name, slug, timezone)')
    .eq('user_id', claims.sub)
    .order('created_at');

  const orgs = (memberships ?? [])
    .filter((m) => m.organizations)
    .map((m) => ({ ...m.organizations!, role: m.role }));
  if (orgs.length === 0) {
    redirect('/entrar?erro=sem-empresa');
  }

  const escolhida = (await cookies()).get(ORG_COOKIE)?.value;
  const org = orgs.find((o) => o.id === escolhida) ?? orgs[0]!;
  return {
    userId: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : '',
    org,
    orgs: orgs.map((o) => ({ id: o.id, name: o.name, role: o.role })),
  };
}
