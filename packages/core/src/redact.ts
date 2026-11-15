/**
 * Mascaramento de dados pessoais e segredos antes de gravar logs, passos de agentes e
 * auditoria (LGPD). Na dúvida, mascara: é melhor perder um detalhe no log do que guardar
 * um telefone de paciente.
 */

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const MAX_STRING_LENGTH = 2000;
const MAX_ARRAY_ITEMS = 100;
const MAX_DEPTH = 8;

/** Chaves cujo valor nunca vai para o log, qualquer que seja o conteúdo. */
const SENSITIVE_KEY =
  /(pass(word)?|senha|secret|segredo|token|api[-_]?key|authorization|cookie|credential|credencial|vault)/i;

/** Ordem importa: padrões mais longos e específicos primeiro. */
const PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[token]'],
  [/\b(?:sk|pk|sb|rk)_[A-Za-z0-9_-]{16,}/g, '[token]'],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi, 'Bearer [token]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  [/(?<!\d)\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}(?!\d)/g, '[cnpj]'],
  [/(?<!\d)\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)/g, '[cpf]'],
  [/(?<!\d)(?:\+?55[\s.-]?)?\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}(?!\d)/g, '[telefone]'],
  [/(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g, '[cartao]'],
];

/** Mascara dados pessoais e segredos num texto e limita o tamanho. */
export function redactText(text: string): string {
  let result = text;
  for (const [pattern, replacement] of PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  if (result.length > MAX_STRING_LENGTH) {
    const extra = result.length - MAX_STRING_LENGTH;
    result = `${result.slice(0, MAX_STRING_LENGTH)}…[+${extra} caracteres]`;
  }
  return result;
}

/** Mascara recursivamente qualquer valor serializável em JSON. */
export function redact(value: unknown, depth = 0): JsonValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    return redactText(value);
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (depth >= MAX_DEPTH) {
    return '[estrutura profunda omitida]';
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => redact(item, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) {
      items.push(`[+${value.length - MAX_ARRAY_ITEMS} itens]`);
    }
    return items;
  }
  if (typeof value === 'object') {
    const result: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = SENSITIVE_KEY.test(key) ? '[oculto]' : redact(entry, depth + 1);
    }
    return result;
  }
  return null;
}
