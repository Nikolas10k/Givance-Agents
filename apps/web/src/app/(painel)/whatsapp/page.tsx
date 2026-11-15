import type { Metadata } from 'next';
import { formatDateTime } from '@/lib/format';
import { requirePanelSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { VerificacaoForm } from './form';

export const metadata: Metadata = { title: 'WhatsApp' };

export default async function WhatsAppPage() {
  const session = await requirePanelSession();
  const supabase = await createClient();
  const { data: canais } = await supabase
    .from('channels')
    .select('address_e164, verified_at, last_inbound_at, quiet_hours')
    .eq('org_id', session.org.id)
    .eq('user_id', session.userId)
    .eq('kind', 'whatsapp')
    .not('verified_at', 'is', null);
  const canal = canais?.[0];
  const silencio = (canal?.quiet_hours ?? null) as { inicio?: string; fim?: string } | null;
  const tz = session.org.timezone;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">WhatsApp</h1>
        <p className="mt-1 text-sm text-suave">
          Por aqui você manda pedidos ao funcionário, recebe prévias para confirmar e avisos do que
          é importante.
        </p>
      </div>

      <section className="rounded-lg border border-linha bg-superficie">
        <h2 className="border-b border-linha px-4 py-3 text-sm font-semibold">Seu número</h2>
        <div className="space-y-4 px-4 py-4">
          {canal ? (
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-suave">Número</dt>
                <dd className="font-medium">{canal.address_e164}</dd>
              </div>
              <div>
                <dt className="text-suave">Ligado em</dt>
                <dd>{formatDateTime(canal.verified_at!, tz)}</dd>
              </div>
              <div>
                <dt className="text-suave">Última mensagem sua</dt>
                <dd>{canal.last_inbound_at ? formatDateTime(canal.last_inbound_at, tz) : '—'}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-suave">
              Nenhum número ligado ainda. Gere um código e envie pelo seu WhatsApp para provar que o
              número é seu.
            </p>
          )}
          <VerificacaoForm
            numeroGivance={process.env.NEXT_PUBLIC_WHATSAPP_NUMERO_GIVANCE ?? null}
          />
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-linha bg-superficie">
        <h2 className="border-b border-linha px-4 py-3 text-sm font-semibold">Como funciona</h2>
        <ul className="list-disc space-y-2 py-4 pl-9 pr-4 text-sm leading-6">
          <li>
            Escreva o pedido como falaria com um colega. Para posts, mande a foto com o pedido na
            legenda.
          </li>
          <li>
            Quando o funcionário precisar da sua confirmação, chega uma prévia com os botões
            Aprovar, Editar e Recusar.
          </li>
          <li>Em Editar, responda com o que quer mudar; ele ajusta e manda de novo.</li>
          <li>Ações que gastam dinheiro só são aprovadas aqui no painel.</li>
          <li>
            Horário de silêncio:{' '}
            {silencio?.inicio && silencio?.fim
              ? `das ${silencio.inicio} às ${silencio.fim}. Avisos nesse horário ficam para depois.`
              : 'não definido.'}
          </li>
        </ul>
      </section>
    </main>
  );
}
