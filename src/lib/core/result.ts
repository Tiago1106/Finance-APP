/**
 * Result pattern do core (ver CLAUDE.md secao 5):
 * funcoes de lib/core nunca lancam — retornam erro tipado.
 */
export type Result<T, E = CoreError> = { ok: true; data: T } | { ok: false; error: E };

export type CoreError = {
  code: string;
  message: string;
};

export function ok<T>(data: T): Result<T, never> {
  return { ok: true, data };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
