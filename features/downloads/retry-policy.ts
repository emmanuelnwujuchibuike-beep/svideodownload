/**
 * Which download failures are worth another attempt.
 *
 * ── Why this is its own module ────────────────────────────────────────────────
 * It lived inside `manager.ts`, which is a `"use client"` module full of
 * browser APIs and therefore effectively untestable in a unit run. That is how
 * the two bugs below survived: both are invisible to tsc, eslint and the build,
 * and only a test that RUNS the predicate can see either.
 *
 * ── 🔴 Bug one: 429 was retryable ─────────────────────────────────────────────
 * `/api/download` spends one unit of the per-plan daily cap per REQUEST, and
 * auto-retry makes up to three requests per download. So a free visitor's cap
 * quietly became a third of its stated value — and once it ran out, every 429
 * was itself retried, spending three more units per failure and pushing the
 * limit further away. The counter is keyed by UTC day, so the runaway lasted
 * until midnight. Owner: "all downloads are not working, it's showing HTTP 429,
 * and it affected all platform download."
 *
 * ── 🔴 Bug two: a regex containing literal control bytes ──────────────────────
 * The "settled failure" line was written through a shell heredoc that ate its
 * backslashes, leaving two literal BACKSPACE bytes where the `\b` word
 * boundaries belong. The result is a perfectly valid regex that can only match
 * a control character — so it matched nothing, and 404s, 403s and 410s were
 * retried three times each. Invisible in an editor, invisible to every tool in
 * the pipeline, and on a metered endpoint it meant every dead link cost three
 * downloads. `retry-policy.test.ts` asserts the behaviour AND scans this file's
 * bytes, because only the second check can catch it coming back.
 */

/** Retry attempts per download, including the first. */
export const MAX_ATTEMPTS = 3;

/** Backoff between attempts. Short — the member is watching a progress card. */
export const RETRY_DELAY_MS = [800, 2500];

export function isRetryable(reason: string): boolean {
  // 429 means "stop sending". Retrying it is what turns a momentary limit into
  // an outage, and on a quota-metered endpoint it also deepens the hole.
  if (/\b429\b|too many|rate limit|daily download limit/i.test(reason)) return false;
  // A definitive "not there" or "not allowed" says the same thing every time.
  if (/\b(?:404|403|401|410)\b/.test(reason)) return false;
  if (/private|removed|expired|not found|unavailable in your/i.test(reason)) return false;
  // Everything else — 502s above all, which is most of the real error log — is
  // a transient upstream hiccup that usually succeeds on the next attempt.
  return true;
}
