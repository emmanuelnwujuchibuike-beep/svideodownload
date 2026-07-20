import { createClient } from "@/lib/supabase/server";

/**
 * Aggregate learning engagement — the read side of migration 0089.
 *
 * ── What this deliberately cannot tell you ────────────────────────────────────
 *
 * Counts per corpus item, and nothing else. No user ids, no "who completed
 * this", no cohort breakdown, and no bucket smaller than the k-anonymity floor
 * enforced in the function itself. The suppression happens in SQL rather than
 * here on purpose: a filter applied in application code is one refactor away
 * from being dropped, and the rows would already have crossed the wire by then.
 *
 * ── Why the shape is "null means unavailable" ─────────────────────────────────
 *
 * `0089` may not be applied yet — two migrations were already pending when it
 * was written. An unapplied function raises `42883` (undefined_function), which
 * is caught and reported as unavailable rather than thrown. The admin page then
 * says so plainly instead of 500ing, the same defensive shape 0073 established
 * and 0088 reuses.
 *
 * `42501` is the function's own authorization refusal. It is treated as
 * unavailable too — the caller is already behind the admin guard on the page, so
 * reaching it means something is wrong with the session rather than with the
 * data, and either way there is nothing to render.
 */

export interface EngagementRow {
  itemKind: "lesson" | "article";
  itemSlug: string;
  readers: number;
  completions: number;
  bookmarks: number;
}

export type EngagementResult =
  | { available: true; rows: EngagementRow[] }
  /** The migration is not applied, or the caller was refused. */
  | { available: false; reason: "not-migrated" | "not-authorized" | "error" };

/** Postgres codes that mean "this is not a fault worth throwing over". */
const NOT_MIGRATED = new Set(["42883", "42P01", "PGRST202"]);

export async function learningEngagement(): Promise<EngagementResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("learning_engagement");

  if (error) {
    if (NOT_MIGRATED.has(error.code ?? "")) return { available: false, reason: "not-migrated" };
    if (error.code === "42501") return { available: false, reason: "not-authorized" };
    return { available: false, reason: "error" };
  }

  const rows: EngagementRow[] = (data ?? []).map(
    (row: {
      item_kind: string;
      item_slug: string;
      readers: number;
      completions: number;
      bookmarks: number;
    }) => ({
      itemKind: row.item_kind === "article" ? "article" : "lesson",
      itemSlug: row.item_slug,
      readers: Number(row.readers),
      completions: Number(row.completions),
      bookmarks: Number(row.bookmarks),
    }),
  );

  return { available: true, rows };
}

/**
 * Completion rate for a row, as a fraction — or null when it would be noise.
 *
 * Returned as a fraction rather than a formatted percentage so the caller
 * decides presentation. Null when there are no readers at all, because "0%
 * completion" and "nobody has opened it" are different facts and only one of
 * them is a problem with the lesson.
 */
export function completionRate(row: EngagementRow): number | null {
  if (row.readers <= 0) return null;
  return row.completions / row.readers;
}
