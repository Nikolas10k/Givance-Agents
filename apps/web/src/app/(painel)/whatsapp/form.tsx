'use client';

import { useActionState } from 'react';
import { gerarCodigo, type VerificacaoState } from './actions';

export function VerificacaoForm({ numeroGivance }: { numeroGivance: string | null }) {
  const [state, action, pending] = useActionState<VerificacaoState, FormData>(gerarCodigo, {
    status: 'inicial',
  });

  if (state.status === 'codigo' && state.codigo) {
    const texto = `GIVANCE ${state.codigo}`;
    const link = numeroGivance
      ? `https://wa.me/${numeroGivance.replace(/\D/g, '')}?text=${encodeURIComponent(texto)}`
      : null;
    return (
      <div className="space-y-3" role="status">
        <p className="text-sm">Envie esta mensagem, do seu WhatsApp, para o número da Givance:</p>
        <p className="rounded-md border border-linha bg-fundo px-4 py-3 text-center font-mono text-2xl font-semibold tracking-widest">
          {texto}
        </p>
        {numeroGivance && <p className="text-sm text-suave">Número da Givance: {numeroGivance}</p>}
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center rounded-md bg-acento px-4 text-sm font-medium text-white hover:bg-acento-forte"
          >
            Abrir no WhatsApp
          </a>
        )}
        <p className="text-xs text-suave">
          O código vale por 15 minutos. Depois de enviar, atualize esta página.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <div className="space-y-1.5">
        <label htmlFor="numero" className="block text-sm font-medium">
          Seu WhatsApp (com DDD)
        </label>
        <input
          id="numero"
          name="numero"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          aria-invalid={state.status === 'erro'}
          aria-describedby={state.status === 'erro' ? 'numero-erro' : undefined}
          className="block h-11 w-full max-w-xs rounded-md border border-linha bg-superficie px-3 text-base outline-none focus:border-acento"
        />
        {state.status === 'erro' && (
          <p id="numero-erro" className="text-sm text-erro">
            {state.message}
          </p>
        )}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="h-10 rounded-md bg-acento px-4 text-sm font-medium text-white hover:bg-acento-forte disabled:opacity-70"
      >
        {pending ? 'Gerando…' : 'Gerar código de verificação'}
      </button>
    </form>
  );
}
