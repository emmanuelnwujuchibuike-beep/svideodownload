/**
 * Repost anti-spam (Feature 15 · Part 4).
 *
 * ── Three verdicts, and the middle one is the important one ───────────────
 * A binary allow/block limiter is the wrong tool here. Blocking a false
 * positive costs a real member a feature they did nothing wrong to lose;
 * `throttle` costs a spammer their reach and is invisible to everyone else —
 * the repost is written, the reposter sees it on their own profile, and the
 * distribution engine simply never picks it up. Almost every detector below
 * lands on `throttle` for exactly that reason. `block` is reserved for rates no
 * human hand produces.
 *
 * ── Why this is pure, and reads history rather than a counter ─────────────
 * Every input is the reposter's OWN recent rows, so the whole policy is
 * testable without Redis and the same verdict can be recomputed after the fact
 * for an appeal. The Upstash sliding window (`lib/rate-limit.ts`) still sits in
 * front of the route as the cross-instance backstop; this module is the part
 * that can explain itself.
 *
 * ── What it deliberately does not claim to detect ─────────────────────────
 * "Bot activity", "spam networks" and "click farms" from the brief are
 * cross-account, graph-scale detections. Nothing here can see another account's
 * rows, so nothing here pretends to. Coordinated-network detection needs an
 * offline job over the whole graph and is named as such in the Part 4 doc
 * rather than being faked with a single-account heuristic wearing that label.
 *
 * Pure: no React, no Supabase, no I/O.
 */

export interface RepostHistoryEntry {
  postId: string;
  creatorId: string;
  /** Epoch ms. */
  createdAt: number;
  hasCaption: boolean;
}

export interface AntiSpamInput {
  /** The reposter's recent reposts, any order. The caller fetches a bounded window. */
  recent: readonly RepostHistoryEntry[];
  /** How many times this member has already reposted THIS post and undone it. */
  repeatsOfTarget: number;
  /** The creator of the post being reposted right now. */
  targetCreatorId: string;
  now: number;
}

export type SpamVerdict = "allow" | "throttle" | "block";

export interface AntiSpamResult {
  verdict: SpamVerdict;
  /** Plain-language reasons. Safe to show the member — none of them name anyone else. */
  reasons: string[];
  /** Only set on `block`: when the action becomes available again. */
  retryAfterMs?: number;
}

const MIN = 60_000;
const HOUR = 60 * MIN;

export const LIMITS = {
  /** No human recommends nine things in five minutes. */
  burstWindowMs: 5 * MIN,
  burstMax: 8,
  /** Generous — a very active day, not a script. */
  dailyMax: 40,
  /** Repost, undo, repost, undo: each cycle fires the creator a fresh notification. */
  repeatMax: 3,
  /** Of the last ten, how many may come from one creator before it reads as promotion. */
  creatorShareWindow: 10,
  creatorShareMax: 6,
  /** Volume with not one word of recommendation attached. */
  uncaptionedDailyMax: 20,
} as const;

/**
 * Should this repost be written, written-but-hidden, or refused?
 *
 * Ordered most-severe first so the returned verdict is the strongest one that
 * fired, and every reason that fired is still reported — a member told only the
 * first of three problems fixes one and hits the next.
 */
export function checkRepostSpam(input: AntiSpamInput): AntiSpamResult {
  const reasons: string[] = [];
  let verdict: SpamVerdict = "allow";
  let retryAfterMs: number | undefined;

  const inWindow = (ms: number) => input.recent.filter((r) => input.now - r.createdAt < ms);

  const burst = inWindow(LIMITS.burstWindowMs);
  if (burst.length >= LIMITS.burstMax) {
    verdict = "block";
    reasons.push("You're reposting very quickly. Take a moment.");
    // The oldest entry in the window is the one whose expiry frees a slot.
    const oldest = Math.min(...burst.map((r) => r.createdAt));
    retryAfterMs = Math.max(1000, LIMITS.burstWindowMs - (input.now - oldest));
  }

  const daily = inWindow(24 * HOUR);
  if (daily.length >= LIMITS.dailyMax) {
    verdict = "block";
    reasons.push("You've reached the daily repost limit.");
    const oldest = Math.min(...daily.map((r) => r.createdAt));
    retryAfterMs = Math.max(retryAfterMs ?? 0, 24 * HOUR - (input.now - oldest));
  }

  if (input.repeatsOfTarget >= LIMITS.repeatMax) {
    verdict = "block";
    reasons.push("You've reposted and removed this several times already.");
    // No retry window: this one is about a specific post, not a rate. The member
    // can repost anything else immediately, which is why it must not set a timer
    // that would read as a global lockout.
  }

  // ── Throttles: written, but not distributed ──────────────────────────────
  if (verdict !== "block") {
    const lastTen = [...input.recent].sort((a, b) => b.createdAt - a.createdAt).slice(0, LIMITS.creatorShareWindow);
    const sameCreator = lastTen.filter((r) => r.creatorId === input.targetCreatorId).length;
    if (lastTen.length >= LIMITS.creatorShareWindow && sameCreator + 1 > LIMITS.creatorShareMax) {
      verdict = "throttle";
      reasons.push("Most of your recent reposts are from one creator.");
    }

    const uncaptioned = daily.filter((r) => !r.hasCaption).length;
    if (daily.length >= LIMITS.uncaptionedDailyMax && uncaptioned === daily.length) {
      verdict = "throttle";
      reasons.push("Reposts with a note reach more people than reposts without one.");
    }
  }

  return { verdict, reasons, ...(retryAfterMs != null ? { retryAfterMs: Math.round(retryAfterMs) } : {}) };
}
