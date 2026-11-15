import { createHash } from 'node:crypto';

/** JSON com chaves ordenadas: o mesmo conteúdo sempre gera o mesmo texto. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
}

/** Mesma tarefa + mesmo tipo + mesmo payload = mesma chave. */
export function actionIdempotencyKey(taskId: string, actionType: string, payload: unknown): string {
  const digest = createHash('sha256')
    .update(`${taskId}\n${actionType}\n${stableStringify(payload)}`)
    .digest('hex');
  return `acao:${digest}`;
}
