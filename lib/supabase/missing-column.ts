/**
 * "This column isn't in the database yet" — in BOTH of the codes it arrives as.
 *
 * Postgres says 42703 (undefined_column), which is what a SELECT naming an
 * unknown column gets back. But an INSERT, UPSERT or UPDATE whose payload has
 * an unknown key is refused by PostgREST before Postgres sees it, as PGRST204
 * ("Could not find the 'x' column of 't' in the schema cache").
 *
 * Owner, 2026-10-10 ("when I try to repost it shows couldn't repost"): the
 * repost route only knew 42703, production had not run the migration that adds
 * `reposts.throttled_at`, so every repost failed with a 500 instead of being
 * saved without that one column. Every write-path fallback goes through here.
 */
export interface DbErrorLike {
  code?: string | null;
  message?: string | null;
}

export function isMissingColumn(error: DbErrorLike | null | undefined): boolean {
  return error?.code === "42703" || error?.code === "PGRST204";
}

/** The missing column's name when the error says it, else null. */
export function missingColumnName(error: DbErrorLike | null | undefined): string | null {
  if (!isMissingColumn(error)) return null;
  const m = error?.message ?? "";
  return m.match(/Could not find the '([^']+)' column/)?.[1] ?? m.match(/column "?(?:[a-z_]+\.)?([a-z_]+)"? (?:of relation "[^"]+" )?does not exist/i)?.[1] ?? null;
}

/**
 * Insert a row, dropping ONE optional column at a time while the database says
 * it doesn't exist yet. Required keys are never dropped: if one of those is
 * missing, the error is returned as it came.
 */
export async function insertDroppingMissing<T>(
  run: (row: Record<string, unknown>) => PromiseLike<{ data: T | null; error: DbErrorLike | null }>,
  row: Record<string, unknown>,
  required: readonly string[],
): Promise<{ data: T | null; error: DbErrorLike | null; dropped: string[] }> {
  const current = { ...row };
  const dropped: string[] = [];
  for (let i = 0; i <= Object.keys(row).length; i += 1) {
    const { data, error } = await run(current);
    if (!error) return { data, error: null, dropped };
    const col = missingColumnName(error);
    if (!col || !(col in current) || required.includes(col)) return { data: null, error, dropped };
    delete current[col];
    dropped.push(col);
  }
  return { data: null, error: { code: "loop", message: "too many missing columns" }, dropped };
}
