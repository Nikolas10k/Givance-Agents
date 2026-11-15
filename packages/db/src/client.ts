import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

/** Cliente tipado com o schema do banco. */
export type TypedClient = SupabaseClient<Database>;

/** Erro de banco com a operação que falhou e o código do Postgres. */
export class DbError extends Error {
  constructor(
    readonly operation: string,
    readonly code: string | undefined,
    message: string,
  ) {
    super(`${operation}: ${message}`);
    this.name = 'DbError';
  }
}

interface PostgrestLikeError {
  message: string;
  code?: string;
}

/** Dados do ramo de sucesso de uma resposta do supabase-js. */
type DataOf<R> = R extends { data: infer D; error: null } ? D : never;

type AnyResult = { data: unknown; error: PostgrestLikeError | null };

/** Lança DbError se a operação falhou. Para escritas sem retorno. */
export function assertOk(operation: string, result: { error: PostgrestLikeError | null }): void {
  if (result.error) {
    throw new DbError(operation, result.error.code, result.error.message);
  }
}

/** Devolve os dados (obrigatórios) ou lança DbError. Para .single(), inserts com select e RPCs. */
export function unwrap<R extends AnyResult>(operation: string, result: R): NonNullable<DataOf<R>> {
  assertOk(operation, result);
  if (result.data === null || result.data === undefined) {
    throw new DbError(operation, undefined, 'nenhum dado retornado');
  }
  return result.data as NonNullable<DataOf<R>>;
}

/** Devolve os dados, que podem não existir (.maybeSingle(), listas). */
export function unwrapMaybe<R extends AnyResult>(operation: string, result: R): DataOf<R> | null {
  assertOk(operation, result);
  return (result.data ?? null) as DataOf<R> | null;
}

/** Violação de unicidade (23505). */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof DbError && error.code === '23505';
}
