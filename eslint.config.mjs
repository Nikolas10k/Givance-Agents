// @ts-check
import js from '@eslint/js';
import nextVitals from 'eslint-config-next/core-web-vitals';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Regras de importação que protegem o isolamento entre empresas:
 * - só o pacote @givance/db fala diretamente com o Supabase;
 * - o cliente com chave secreta (que ignora RLS) só pode ser usado pelo worker
 *   e por código de servidor do painel em apps/web/src/server.
 */
const supabaseDireto = {
  name: '@supabase/supabase-js',
  message: 'Use os clientes e repositórios de @givance/db.',
};
const clienteServico = {
  group: ['@givance/db/service'],
  message:
    'O cliente com chave secreta ignora RLS. Use-o só no worker ou em apps/web/src/server/**.',
};

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/next-env.d.ts',
      'supabase/.temp/**',
      'packages/db/src/database.types.ts',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  // Regras do Next.js (React, hooks, acessibilidade) só para o painel.
  ...nextVitals.map((config) => ({
    ...config,
    files: ['apps/web/**/*.{ts,tsx}'],
    settings: { ...config.settings, next: { rootDir: 'apps/web' } },
  })),
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-restricted-imports': ['error', { paths: [supabaseDireto] }],
    },
  },
  {
    files: ['packages/db/**'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: ['apps/web/**'],
    ignores: ['apps/web/src/server/**'],
    rules: {
      'no-restricted-imports': ['error', { paths: [supabaseDireto], patterns: [clienteServico] }],
    },
  },
  {
    files: ['packages/core/**', 'packages/tools/**', 'packages/agents/**'],
    rules: {
      'no-restricted-imports': ['error', { paths: [supabaseDireto], patterns: [clienteServico] }],
    },
  },
);
