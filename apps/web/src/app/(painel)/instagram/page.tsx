import type { Metadata } from 'next';
import { formatDateTime } from '@/lib/format';
import { requirePanelSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { instagramOAuth, podeConectar } from '@/server/instagram';
import { desconectarInstagram } from './actions';
import { UploadMidia } from './upload';

export const metadata: Metadata = { title: 'Instagram' };

const ERROS: Record<string, string> = {
  'nao-configurado':
    'A conexão com o Instagram ainda não foi configurada na Givance (app da Meta). Fale com o suporte.',
  permissao: 'Só o dono ou um admin da empresa pode conectar o Instagram.',
  cancelado: 'A conexão foi cancelada no Instagram. Nada mudou.',
  sessao: 'O pedido de conexão expirou ou veio de outro navegador. Comece de novo por aqui.',
  permissoes:
    'Faltou autorizar a publicação de conteúdo. Conecte de novo e mantenha todas as permissões marcadas.',
  falha: 'O Instagram não respondeu como esperado. Tente de novo em alguns minutos.',
};

const STATUS_POST: Record<string, { rotulo: string; classe: string }> = {
  aguardando_confirmacao: { rotulo: 'Aguardando você', classe: 'bg-alerta-claro text-alerta' },
  agendado: { rotulo: 'Agendado', classe: 'bg-acento-claro text-acento' },
  publicando: { rotulo: 'Publicando', classe: 'bg-acento-claro text-acento' },
  publicado: { rotulo: 'Publicado', classe: 'bg-sucesso-claro text-sucesso' },
  falhou: { rotulo: 'Falhou', classe: 'bg-erro-claro text-erro' },
  cancelado: { rotulo: 'Cancelado', classe: 'bg-fundo text-suave' },
};

const FORMATOS: Record<string, string> = {
  feed: 'Feed',
  carrossel: 'Carrossel',
  reels: 'Reels',
  story: 'Story',
};

export default async function InstagramPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; erro?: string }>;
}) {
  const session = await requirePanelSession();
  const { ok, erro } = await searchParams;
  const supabase = await createClient();
  const tz = session.org.timezone;
  const gestor = podeConectar(session.org.role);
  const configurado = instagramOAuth() !== null;

  const [{ data: conexoes }, { data: posts }, { data: midias }] = await Promise.all([
    supabase
      .from('connections')
      .select('id, status, external_ids, expires_at, last_error, updated_at')
      .eq('org_id', session.org.id)
      .eq('provider', 'instagram')
      .limit(1),
    supabase
      .from('social_posts')
      .select(
        'id, format, caption, status, scheduled_at, published_at, permalink, error, created_at',
      )
      .eq('org_id', session.org.id)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('media_assets')
      .select('id, storage_path, mime_type, caption, width, height, source, created_at')
      .eq('org_id', session.org.id)
      .order('created_at', { ascending: false })
      .limit(24),
  ]);
  const conexao = conexoes?.[0];
  const conta = (conexao?.external_ids ?? {}) as { username?: string };

  const fotos = (midias ?? []).filter((m) => m.mime_type.startsWith('image/'));
  const { data: assinadas } = fotos.length
    ? await supabase.storage.from('midia').createSignedUrls(
        fotos.map((m) => m.storage_path),
        600,
      )
    : { data: [] };
  const miniatura = new Map(
    (assinadas ?? []).flatMap((a) => (a.path && a.signedUrl ? [[a.path, a.signedUrl]] : [])),
  );

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Instagram</h1>
        <p className="mt-1 text-sm text-suave">
          O funcionário prepara os posts e você confirma a prévia com um toque no WhatsApp. Nada é
          publicado sem a sua confirmação.
        </p>
      </div>

      {ok && (
        <p
          role="status"
          className="mb-4 rounded-md bg-sucesso-claro px-4 py-3 text-sm text-sucesso"
        >
          Instagram conectado.
        </p>
      )}
      {erro && (
        <p role="alert" className="mb-4 rounded-md bg-erro-claro px-4 py-3 text-sm text-erro">
          {ERROS[erro] ?? ERROS.falha}
        </p>
      )}

      <section className="rounded-lg border border-linha bg-superficie">
        <h2 className="border-b border-linha px-4 py-3 text-sm font-semibold">Conta</h2>
        <div className="space-y-4 px-4 py-4 text-sm">
          {conexao ? (
            <>
              <dl className="grid gap-3 sm:grid-cols-3">
                <div>
                  <dt className="text-suave">Perfil</dt>
                  <dd className="font-medium">@{conta.username ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-suave">Situação</dt>
                  <dd>
                    {conexao.status === 'ativa' ? (
                      <span className="text-sucesso">Conectada</span>
                    ) : (
                      <span className="text-erro">Precisa reconectar</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-suave">Acesso renovado até</dt>
                  <dd>{conexao.expires_at ? formatDateTime(conexao.expires_at, tz) : '—'}</dd>
                </div>
              </dl>
              {conexao.status !== 'ativa' && (
                <p className="text-erro">
                  O Instagram recusou o acesso (senha trocada ou permissão removida). Conecte de
                  novo para o funcionário voltar a publicar.
                </p>
              )}
              {gestor && (
                <div className="flex flex-wrap gap-3">
                  {conexao.status !== 'ativa' && configurado && (
                    <a
                      href="/api/instagram/conectar"
                      className="inline-flex h-10 items-center rounded-md bg-acento px-4 font-medium text-white hover:bg-acento-forte"
                    >
                      Reconectar Instagram
                    </a>
                  )}
                  <form action={desconectarInstagram}>
                    <button
                      type="submit"
                      className="h-10 rounded-md border border-linha px-4 hover:bg-fundo"
                    >
                      Desconectar @{conta.username ?? 'conta'}
                    </button>
                  </form>
                </div>
              )}
            </>
          ) : (
            <>
              <p className="text-suave">
                Conecte a conta profissional (empresa ou criador) do Instagram. Contas pessoais não
                permitem publicação automática: no app do Instagram, mude em Configurações › Tipo de
                conta.
              </p>
              {gestor && configurado ? (
                <a
                  href="/api/instagram/conectar"
                  className="inline-flex h-10 items-center rounded-md bg-acento px-4 font-medium text-white hover:bg-acento-forte"
                >
                  Conectar Instagram
                </a>
              ) : (
                <p className="text-suave">
                  {gestor
                    ? ERROS['nao-configurado']
                    : 'Peça ao dono da empresa para conectar o Instagram.'}
                </p>
              )}
            </>
          )}
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-linha bg-superficie">
        <h2 className="border-b border-linha px-4 py-3 text-sm font-semibold">Posts</h2>
        {posts && posts.length > 0 ? (
          <ul className="divide-y divide-linha">
            {posts.map((p) => {
              const st = STATUS_POST[p.status] ?? { rotulo: p.status, classe: 'bg-fundo' };
              return (
                <li
                  key={p.id}
                  className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-start sm:gap-4"
                >
                  <span
                    className={`w-fit shrink-0 rounded px-2 py-0.5 text-xs font-medium ${st.classe}`}
                  >
                    {st.rotulo}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate">
                      <span className="font-medium">{FORMATOS[p.format] ?? p.format}</span>
                      {p.caption ? ` · ${p.caption}` : ''}
                    </p>
                    <p className="text-xs text-suave">
                      {p.status === 'publicado' && p.published_at
                        ? `Publicado em ${formatDateTime(p.published_at, tz)}`
                        : p.scheduled_at
                          ? `Para ${formatDateTime(p.scheduled_at, tz)}`
                          : `Pedido em ${formatDateTime(p.created_at, tz)}`}
                      {p.status === 'falhou' && p.error ? ` · ${p.error}` : ''}
                    </p>
                  </div>
                  {p.permalink && (
                    <a
                      href={p.permalink}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 text-acento underline-offset-2 hover:underline"
                    >
                      Ver no Instagram
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-4 py-4 text-sm text-suave">
            Nenhum post ainda. Mande no WhatsApp, por exemplo: “posta essa foto amanhã às 18h
            falando da promoção”, com a foto junto.
          </p>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-linha bg-superficie">
        <h2 className="border-b border-linha px-4 py-3 text-sm font-semibold">Banco de mídia</h2>
        <div className="space-y-5 px-4 py-4">
          <p className="text-sm text-suave">
            Fotos e vídeos que o funcionário pode usar nos posts. O que você manda pelo WhatsApp
            entra aqui sozinho; use o envio abaixo para arquivos maiores ou com mais qualidade.
          </p>
          {gestor && <UploadMidia />}
          {midias && midias.length > 0 ? (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {midias.map((m) => {
                const url = miniatura.get(m.storage_path);
                const descricao =
                  m.caption ?? (m.mime_type.startsWith('video/') ? 'Vídeo' : 'Foto');
                return (
                  <li
                    key={m.id}
                    className="relative aspect-square overflow-hidden rounded-md border border-linha bg-fundo"
                    title={descricao}
                  >
                    {url ? (
                      // Miniatura por URL assinada de curta duração; o next/image não ajuda aqui.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={url} alt={descricao} className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full items-center justify-center p-2 text-center text-xs text-suave">
                        {descricao}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-suave">O banco de mídia está vazio.</p>
          )}
        </div>
      </section>
    </main>
  );
}
