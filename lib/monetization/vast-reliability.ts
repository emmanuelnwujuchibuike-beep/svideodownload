/**
 * The VAST request's reliability RULES — the pure half.
 *
 * ── Why this is separate from the request itself ─────────────────────────────
 *
 * `features/monetization/vast-interstitial/request.ts` is `"use client"`, does
 * the fetching, and owns the player handoff. None of that is testable without a
 * DOM, and the interesting part is not the fetching — it is the decisions:
 * which failures deserve a second ask, which must never get one, and whether
 * there is time left to make it. Those are pure and they are what a regression
 * would silently change.
 *
 * Same split the streak system uses (`lib/streaks/calc.ts` pure, engine does
 * I/O), and for the same reason: it is the only way the awkward cases get
 * tested at all.
 *
 * ── 🔴 THIS LAYER NEVER TOUCHES THE PLAYER ───────────────────────────────────
 *
 * Everything here runs BEFORE a creative exists, and the player is a separate
 * dynamic import that only happens once one is in hand. So no decision in this
 * file can create a second player, replay an impression, or interact with the
 * teardown path. The existing player lifecycle is a protected system and the
 * reliability layer is deliberately kept upstream of it.
 */

/**
 * How one attempt to fetch a creative ended.
 *
 * 🔴 `empty` AND `blocked_or_unavailable` ARE NOT THE SAME FACT, and collapsing
 * them is how a blocked integration reads as an empty one for weeks. The first
 * is the ad network answering "I have nothing right now". The second is never
 * getting an answer at all.
 */
export type ResolveOutcome =
  | "ok"
  | "empty"
  | "http_error"
  | "malformed"
  | "blocked_or_unavailable"
  | "aborted";

/** Only ever ONE retry, and only after this pause. */
export const RETRY_DELAY_MS = 600;

/**
 * Outcomes worth a second ask.
 *
 * These are the shapes a blocked request, a flapping edge node or a truncated
 * response take, and a second ask genuinely resolves them.
 *
 * ⛔ `empty` is absent ON PURPOSE. The network answered and said it has no ad;
 * asking again turns one impression opportunity into two ad requests with no
 * impression behind either, which is exactly what makes a publisher's fill rate
 * look broken to the network — the opposite of the goal.
 *
 * ⛔ `aborted` is absent too. The budget expired or the caller cancelled;
 * retrying past a cancellation is ignoring it.
 */
const RETRYABLE: ReadonlySet<ResolveOutcome> = new Set<ResolveOutcome>([
  "http_error",
  "malformed",
  "blocked_or_unavailable",
]);

export interface RetryDecision {
  retry: boolean;
  /** Why not, when not — carried so the caller can log one honest line. */
  reason: "retryable" | "terminal" | "no-budget" | "aborted";
}

/**
 * Should this failure get its ONE retry?
 *
 * ── The budget check is what stops a slow network getting slower ─────────────
 *
 * A retry only runs if the resolve budget still has room for the pause AND
 * another attempt — measured from what has actually been spent, not assumed.
 * That distinction does the work automatically:
 *
 *   • a BLOCKED request rejects almost immediately, so nearly the whole budget
 *     is left and the retry happens — which is the case retrying exists for;
 *   • a request that failed by TIMING OUT has already spent the budget, so it
 *     gets no second try and the visitor's wait is never doubled.
 *
 * No separate "was it fast?" heuristic is needed; the clock already knows.
 */
export function shouldRetryVast({
  outcome,
  spentMs,
  budgetMs,
  aborted = false,
}: {
  outcome: ResolveOutcome;
  spentMs: number;
  budgetMs: number;
  aborted?: boolean;
}): RetryDecision {
  if (aborted || outcome === "aborted") return { retry: false, reason: "aborted" };
  if (!RETRYABLE.has(outcome)) return { retry: false, reason: "terminal" };
  // Room for the pause AND a second attempt, not just the pause.
  if (budgetMs - spentMs - RETRY_DELAY_MS <= 0) return { retry: false, reason: "no-budget" };
  return { retry: true, reason: "retryable" };
}

/**
 * Did the request fail to reach an answer, as opposed to receiving one?
 *
 * 🔴 The name is the whole point. It says what is OBSERVABLE — the request did
 * not complete — and refuses to assert an extension we cannot see. A metric
 * called "ad blocker detected" that fires on every flaky network is one nobody
 * can act on, and this project has a standing rule against fabricated stats.
 */
export function isBlockedOrUnavailable(outcome: ResolveOutcome): boolean {
  return outcome === "blocked_or_unavailable";
}
