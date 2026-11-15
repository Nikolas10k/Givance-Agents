'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { requirePanelSession } from '@/lib/session';
import { podeConectar } from '@/server/instagram';
import { serviceClient } from '@/server/service';

/** Tipos aceitos no banco de mídia (os que o Instagram publica). */
const TIPOS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};
const MAX_IMAGEM = 15 * 1024 * 1024;
const MAX_VIDEO = 50 * 1024 * 1024;

export async function desconectarInstagram(): Promise<void> {
  const session = await requirePanelSession();
  if (!podeConectar(session.org.role)) return;
  const db = serviceClient();
  const { data } = await db
    .from('connections')
    .delete()
    .eq('org_id', session.org.id)
    .eq('provider', 'instagram')
    .select('id');
  if (data && data.length > 0) {
    await db.from('audit_log').insert({
      org_id: session.org.id,
      actor_type: 'usuario',
      actor_id: session.userId,
      action: 'conexao.instagram_desconectada',
      target: `connection:${data[0]!.id}`,
    });
  }
  revalidatePath('/instagram');
}

export type UploadStart =
  { ok: true; path: string; token: string } | { ok: false; message: string };

/**
 * Prepara o envio de um arquivo direto do navegador para o Storage (o arquivo não passa pelo
 * servidor do painel, que tem limite de tamanho). O caminho é decidido aqui, na pasta da empresa.
 */
export async function iniciarUpload(input: {
  tipo: string;
  tamanho: number;
}): Promise<UploadStart> {
  const session = await requirePanelSession();
  if (!podeConectar(session.org.role)) {
    return { ok: false, message: 'Só o dono ou um admin envia mídias.' };
  }
  const ext = TIPOS[input.tipo];
  if (!ext) return { ok: false, message: 'Envie foto (JPEG, PNG ou WebP) ou vídeo (MP4 ou MOV).' };
  const limite = input.tipo.startsWith('video/') ? MAX_VIDEO : MAX_IMAGEM;
  if (!(input.tamanho > 0) || input.tamanho > limite) {
    return {
      ok: false,
      message: `Arquivo grande demais: até ${Math.round(limite / 1024 / 1024)} MB.`,
    };
  }
  const path = `${session.org.id}/upload-${randomUUID()}.${ext}`;
  const { data, error } = await serviceClient().storage.from('midia').createSignedUploadUrl(path);
  if (error || !data)
    return { ok: false, message: 'Não foi possível preparar o envio. Tente de novo.' };
  return { ok: true, path: data.path, token: data.token };
}

/** Registra no banco de mídia um arquivo que o navegador acabou de enviar. */
export async function registrarUpload(input: {
  path: string;
  tipo: string;
  legenda?: string;
  largura?: number;
  altura?: number;
  duracao?: number;
}): Promise<{ ok: boolean; message?: string }> {
  const session = await requirePanelSession();
  if (!podeConectar(session.org.role)) return { ok: false, message: 'Sem permissão.' };
  const prefixo = `${session.org.id}/upload-`;
  if (!input.path.startsWith(prefixo) || input.path.includes('..') || !TIPOS[input.tipo]) {
    return { ok: false, message: 'Envio inválido.' };
  }
  const db = serviceClient();
  const nome = input.path.slice(session.org.id.length + 1);
  const { data: achados } = await db.storage
    .from('midia')
    .list(session.org.id, { search: nome, limit: 1 });
  const arquivo = achados?.find((f) => f.name === nome);
  if (!arquivo) return { ok: false, message: 'O arquivo não chegou. Tente enviar de novo.' };

  const inteiro = (n: number | undefined) =>
    typeof n === 'number' && Number.isFinite(n) && n > 0 && n < 20_000 ? Math.round(n) : null;
  const { error } = await db.from('media_assets').insert({
    org_id: session.org.id,
    storage_path: input.path,
    mime_type: input.tipo,
    size_bytes: (arquivo.metadata as { size?: number } | null)?.size ?? null,
    source: 'upload',
    caption: input.legenda?.trim().slice(0, 2000) || null,
    created_by: session.userId,
    width: inteiro(input.largura),
    height: inteiro(input.altura),
    duration_seconds:
      typeof input.duracao === 'number' && input.duracao > 0 && input.duracao < 36_000
        ? Math.round(input.duracao * 100) / 100
        : null,
  });
  if (error) return { ok: false, message: 'Não foi possível registrar a mídia.' };
  revalidatePath('/instagram');
  return { ok: true };
}
