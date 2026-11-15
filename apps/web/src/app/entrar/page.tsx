import type { Metadata } from 'next';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Entrar' };

export default function EntrarPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <p className="mb-6 text-center text-sm font-semibold tracking-wide text-acento">
          GIVANCE WORKFORCE
        </p>
        <div className="rounded-lg border border-linha bg-superficie p-6 sm:p-8">
          <LoginForm />
        </div>
        <p className="mt-6 text-center text-xs leading-5 text-suave">
          O acesso é criado pela equipe da Givance. Se você ainda não tem conta, fale com quem
          contratou o serviço.
        </p>
      </div>
    </main>
  );
}
