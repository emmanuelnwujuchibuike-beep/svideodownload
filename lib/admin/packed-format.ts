/**
 * Which status a download row actually had.
 *
 * ── Why this is not `column || packed` ────────────────────────────────────────
 *
 * Owner, 2026-09-03: live activity "shows all download status as completed, even
 * failed, canceled and abandoned".
 *
 * 🔴 `downloads.status` is `not null default 'completed'` (migration 0001), so
 * the column is NEVER falsy. A `column || packed` fallback therefore always
 * short-circuits on the default, and the real outcome — recorded by the client
 * that actually watched the transfer and packed into the `format` string — is
 * never read. Every failure in the feed was reported as a success.
 *
 * The encoder (features/history/sync.ts) writes an EMPTY status field for a
 * completed download and the real word for anything else. So a non-empty packed
 * value is positive evidence of a non-completed outcome, while a column sitting
 * at its default is no evidence at all. Explicit beats default.
 *
 * The column still answers for server-side rows, which carry no packed status.
 *
 * Pure and separate from `activity.ts` so it can be tested: that module imports
 * `server-only`, and a correctness rule nobody can execute in a test is a rule
 * that drifts. Same reasoning as `lib/analytics/windows.ts`.
 */
export function resolveDownloadStatus(
  /** The status packed into `downloads.format`, or null/"" when absent. */
  packed: string | null | undefined,
  /** The `downloads.status` column — defaulted to 'completed', so never falsy. */
  column: string | null | undefined,
): string {
  return packed || column || "completed";
}
