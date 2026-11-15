import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

/**
 * Raiz do conteúdo editável (roles/ e agents/). No repositório é a raiz do monorepo; na
 * imagem do worker, a pasta copiada ao lado do código (GIVANCE_CONTENT_DIR).
 */
export function resolveContentRoot(start: string = process.cwd()): string {
  const fromEnv = process.env.GIVANCE_CONTENT_DIR;
  if (fromEnv) {
    return path.resolve(fromEnv);
  }
  let current = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(current, 'roles')) && existsSync(path.join(current, 'agents'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(
        'Não encontrei as pastas roles/ e agents/. Defina GIVANCE_CONTENT_DIR com o caminho delas.',
      );
    }
    current = parent;
  }
}

export interface LoadedPrompt {
  /** Caminho relativo à raiz do conteúdo (ex.: agents/social/system.md). */
  path: string;
  text: string;
  sha256: string;
  meta: Record<string, unknown>;
}

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Lê um prompt, separando o cabeçalho (versão, data) do texto que vai para o modelo. */
export async function loadPrompt(contentRoot: string, relativePath: string): Promise<LoadedPrompt> {
  const raw = await readFile(path.join(contentRoot, relativePath), 'utf8');
  const match = FRONT_MATTER.exec(raw);
  const meta = match ? ((parseYaml(match[1] ?? '') as Record<string, unknown> | null) ?? {}) : {};
  const text = (match ? raw.slice(match[0].length) : raw).trim();
  if (text.length === 0) {
    throw new Error(`Prompt vazio: ${relativePath}`);
  }
  return {
    path: relativePath,
    text,
    sha256: createHash('sha256').update(text).digest('hex'),
    meta,
  };
}
