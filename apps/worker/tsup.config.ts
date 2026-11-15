import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Pacotes internos (@givance/*) entram no bundle; dependências externas ficam em node_modules.
  noExternal: [/^@givance\//],
  external: ['@anthropic-ai/claude-agent-sdk'],
  // Dependências CommonJS empacotadas em ESM precisam de um require de verdade.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
