'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { createBrowserSupabase } from '@/lib/supabase/client';
import { iniciarUpload, registrarUpload } from './actions';

/** Dimensões (e duração, para vídeo) lidas no navegador, para orientar o funcionário. */
async function medir(file: File): Promise<{ largura?: number; altura?: number; duracao?: number }> {
  const url = URL.createObjectURL(file);
  try {
    if (file.type.startsWith('image/')) {
      const bitmap = await createImageBitmap(file);
      const r = { largura: bitmap.width, altura: bitmap.height };
      bitmap.close();
      return r;
    }
    return await new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () =>
        resolve({ largura: video.videoWidth, altura: video.videoHeight, duracao: video.duration });
      video.onerror = () => resolve({});
      video.src = url;
    });
  } catch {
    return {};
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function UploadMidia() {
  const router = useRouter();
  const arquivoRef = useRef<HTMLInputElement>(null);
  const [estado, setEstado] = useState<{
    tipo: 'livre' | 'enviando' | 'ok' | 'erro';
    msg?: string;
  }>({ tipo: 'livre' });

  async function enviar(form: HTMLFormElement) {
    const file = arquivoRef.current?.files?.[0];
    if (!file) {
      setEstado({ tipo: 'erro', msg: 'Escolha uma foto ou um vídeo.' });
      return;
    }
    setEstado({ tipo: 'enviando' });
    const inicio = await iniciarUpload({ tipo: file.type, tamanho: file.size });
    if (!inicio.ok) {
      setEstado({ tipo: 'erro', msg: inicio.message });
      return;
    }
    const medidas = await medir(file);
    const { error } = await createBrowserSupabase()
      .storage.from('midia')
      .uploadToSignedUrl(inicio.path, inicio.token, file, { contentType: file.type });
    if (error) {
      setEstado({ tipo: 'erro', msg: 'O envio falhou. Confira a conexão e tente de novo.' });
      return;
    }
    const legenda = String(new FormData(form).get('legenda') ?? '');
    const registro = await registrarUpload({
      path: inicio.path,
      tipo: file.type,
      legenda,
      ...medidas,
    });
    if (!registro.ok) {
      setEstado({ tipo: 'erro', msg: registro.message ?? 'Não foi possível registrar a mídia.' });
      return;
    }
    form.reset();
    setEstado({ tipo: 'ok', msg: 'Mídia adicionada ao banco.' });
    router.refresh();
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void enviar(e.currentTarget);
      }}
    >
      <div className="space-y-1.5">
        <label htmlFor="arquivo" className="block text-sm font-medium">
          Foto ou vídeo
        </label>
        <input
          ref={arquivoRef}
          id="arquivo"
          name="arquivo"
          type="file"
          accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
          className="block w-full text-sm file:mr-3 file:h-9 file:rounded-md file:border file:border-linha file:bg-superficie file:px-3 file:text-sm"
        />
        <p className="text-xs text-suave">Foto até 15 MB; vídeo até 50 MB (MP4 ou MOV).</p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="legenda" className="block text-sm font-medium">
          Do que se trata (opcional)
        </label>
        <input
          id="legenda"
          name="legenda"
          type="text"
          maxLength={300}
          placeholder="Ex.: vitrine nova de Natal"
          className="block h-10 w-full rounded-md border border-linha bg-superficie px-3 text-sm outline-none focus:border-acento"
        />
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={estado.tipo === 'enviando'}
          className="h-10 rounded-md bg-acento px-4 text-sm font-medium text-white hover:bg-acento-forte disabled:opacity-60"
        >
          {estado.tipo === 'enviando' ? 'Enviando…' : 'Adicionar ao banco'}
        </button>
        {estado.msg && (
          <p
            role={estado.tipo === 'erro' ? 'alert' : 'status'}
            className={`text-sm ${estado.tipo === 'erro' ? 'text-erro' : 'text-sucesso'}`}
          >
            {estado.msg}
          </p>
        )}
      </div>
    </form>
  );
}
