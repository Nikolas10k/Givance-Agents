import Link from 'next/link';
import type { ReactNode } from 'react';
import { requirePanelSession } from '@/lib/session';
import { switchOrg } from './actions';

export default async function PainelLayout({ children }: { children: ReactNode }) {
  const session = await requirePanelSession();

  return (
    <div className="min-h-dvh">
      <header className="border-b border-linha bg-superficie">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-4">
            <span className="text-sm font-semibold tracking-wide text-acento">
              GIVANCE WORKFORCE
            </span>
            <nav className="flex items-center gap-1 text-sm" aria-label="Seções do painel">
              <Link href="/" className="rounded-md px-2 py-1 hover:bg-fundo">
                Início
              </Link>
              <Link href="/whatsapp" className="rounded-md px-2 py-1 hover:bg-fundo">
                WhatsApp
              </Link>
              <Link href="/instagram" className="rounded-md px-2 py-1 hover:bg-fundo">
                Instagram
              </Link>
            </nav>
            {session.orgs.length > 1 ? (
              <form action={switchOrg} className="flex items-center gap-2">
                <label htmlFor="org" className="sr-only">
                  Empresa
                </label>
                <select
                  id="org"
                  name="org"
                  defaultValue={session.org.id}
                  className="h-9 max-w-[14rem] truncate rounded-md border border-linha bg-superficie px-2 text-sm"
                >
                  {session.orgs.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="h-9 rounded-md border border-linha px-3 text-sm hover:bg-fundo"
                >
                  Trocar empresa
                </button>
              </form>
            ) : (
              <span className="truncate text-sm text-suave">{session.org.name}</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden truncate text-sm text-suave sm:inline">{session.email}</span>
            <form action="/sair" method="post">
              <button
                type="submit"
                className="h-9 rounded-md border border-linha px-3 text-sm hover:bg-fundo"
              >
                Sair
              </button>
            </form>
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
