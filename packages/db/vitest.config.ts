import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Os testes de banco usam a mesma instância local; um arquivo por vez evita interferência.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
