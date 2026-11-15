'use client';

import { useActionState, useState } from 'react';
import { sendMagicLink, type LoginState } from './actions';

const INITIAL: LoginState = { status: 'inicial' };

export function LoginForm() {
  const [state, action, pending] = useActionState(sendMagicLink, INITIAL);
  const [touched, setTouched] = useState(false);
  const [email, setEmail] = useState('');
  const invalid = touched && email.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);

  if (state.status === 'enviado') {
    return (
      <div className="space-y-4" role="status">
        <h1 className="text-xl font-semibold">Confira seu e-mail</h1>
        <p className="text-sm leading-6 text-suave">
          Se <strong className="text-tinta">{state.email}</strong> tiver acesso, enviamos um link
          para entrar. Ele vale por uma hora e funciona uma única vez.
        </p>
        <a href="/entrar" className="inline-block text-sm font-medium text-acento hover:underline">
          Usar outro e-mail
        </a>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-5" noValidate>
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Entrar no painel</h1>
        <p className="text-sm text-suave">
          Você recebe um link de acesso no seu e-mail. Não precisa de senha.
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="email" className="block text-sm font-medium">
          E-mail
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          onBlur={() => setTouched(true)}
          aria-invalid={invalid || state.status === 'erro'}
          aria-describedby={invalid || state.status === 'erro' ? 'email-erro' : undefined}
          className="block h-11 w-full rounded-md border border-linha bg-superficie px-3 text-base outline-none focus:border-acento"
        />
        {(invalid || state.status === 'erro') && (
          <p id="email-erro" className="text-sm text-erro">
            {invalid
              ? 'Confira o e-mail: ele precisa ter o formato nome@empresa.com.br.'
              : state.message}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="flex h-11 w-full items-center justify-center rounded-md bg-acento px-4 text-sm font-medium text-white transition-colors hover:bg-acento-forte disabled:opacity-70"
      >
        {pending ? 'Enviando…' : 'Enviar link de acesso'}
      </button>
    </form>
  );
}
