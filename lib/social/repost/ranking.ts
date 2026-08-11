/**
 * Smart repost distribution (Feature 15 · Part 4).
 *
 * "Do not show every repost to everyone. Instead intelligently rank reposts."
 *
 * ── The caps matter more than the scores ──────────────────────────────────
 * A ranking function alone cannot stop a feed flooding; it only decides the
 * ORDER in which it floods. What actually keeps a repost feeling like a
 * recommendation is the ceiling: at most two per page, at most one per person,
 * at most one per creator, never two adjacent. Those rules are enforced in
 * `capReposts` and they are the part of this module that would be missed first
 * if it were deleted.
 *
 * ── Reputation is a MULTIPLIER, never points ──────────────────────────────
 * As an additive term, a high-reputation stranger would outrank a close
 * friend's recommendation. That inverts the brief's own stated priority —
 * "Friends first. Creators second. Algorithms third." As a ±15% multiplier it
 * can only reorder things that were already close, which is the most influence
 * an algorithmic score should have over a human relationship.
 *
 * ── What is deliberately NOT an input ─────────────────────────────────────
 *  · Location. The brief marks it optional; no location is collected for the
 *    feed today, and starting to collect it in order to rank reposts is a data-
 *    collection decision, not a ranking change.
 *  · Anything about the OTHER person's behaviour toward the viewer. Same line
 *    `graph/strength.ts` refuses to cross, for the same reason.
 *  · Watch history as raw viewing records. The interest signal reads the
 *    viewer's own ENGAGED categories (things they liked, saved, reposted) —
 *    deliberate acts, not passive observation.
 *
 * Pure: no React, no Supabase, no I/O.
 */

import type { RepostAudience } from "./audience";

export interface RepostCandidate {
  repostId: string;
  postId: string;
  reposterId: string;
  /** The original creator — used for the per-creator cap and the follow penalty. */
  creatorId: string;
  /** Epoch ms. */
  createdAt: number;
  audience: RepostAudience;
  /** The reposter wrote a recommendation caption. */
  hasCaption: boolean;
  /** How many visible-to-this-viewer people reposted this same post. */
  reposterCount: number;
  /** Provenance: this reposter found it through another repost. */
  sourceRepostId: string | null;
  /** The original post's category, for interest overlap. Null when uncategorised. */
  category: string | null;
}

export interface RankingContext {
  /** Relationship strength 0–100 per reposter, from `graph/strength.ts`. */
  strength: ReadonlyMap<string, number>;
  /** Friends in common per reposter. */
  mutualFriends: ReadonlyMap<string, number>;
  /** Reposters the viewer marked as favourites. */
  closeFriends: ReadonlySet<string>;
  /** Categories the viewer has actively engaged with. */
  interests: ReadonlySet<string>;
  /** Creators the viewer already follows. */
  followedCreators: ReadonlySet<string>;
  /** Recommendation Circle™ score 0–100 per reposter. Absent = neutral. */
  reputation: ReadonlyMap<string, number>;
  /** Posts already in the feed page, or already engaged with. */
  excludedPostIds: ReadonlySet<string>;
  /** Posts the viewer dismissed (suppressed for 30 days — the caller applies the window). */
  dismissedPostIds: ReadonlySet<string>;
  now: number;
}

export type RepostSignalKind =
  | "close_friend"
  | "strong_tie"
  | "mutual_friends"
  | "many_reposters"
  | "second_degree"
  | "shared_interest"
  | "recommended";

export interface RepostSignal {
  kind: RepostSignalKind;
  /** Points this signal contributed. Used to pick the reason, biggest first. */
  weight: number;
}

export interface RankedRepost {
  candidate: RepostCandidate;
  score: number;
  /** Contributions, largest first. `reason.ts` reads the head of this list. */
  signals: RepostSignal[];
}

export interface RankingLimits {
  maxPerPage: number;
  maxPerReposter: number;
  maxPerCreator: number;
}

export const DEFAULT_LIMITS: RankingLimits = {
  maxPerPage: 2,
  maxPerReposter: 1,
  maxPerCreator: 1,
};

/** A repost older than this has stopped being news. */
const RECENCY_HALF_LIFE_H = 18;
/** Even a stale repost from a close friend is worth showing — decay has a floor. */
const RECENCY_FLOOR = 0.55;

function recencyFactor(ageMs: number): number {
  const hours = Math.max(0, ageMs) / 3_600_000;
  return Math.max(RECENCY_FLOOR, Math.pow(0.5, hours / RECENCY_HALF_LIFE_H));
}

function reputationFactor(rep: number | undefined): number {
  if (rep == null) return 1; // Unknown is neutral. Unknown is not zero.
  return 0.85 + (Math.max(0, Math.min(100, rep)) / 100) * 0.3;
}

/**
 * Score one candidate. Exported for tests and for the reason string, which must
 * be produced from the SAME signals that made the pick — a component
 * re-deriving "why" from the rendered props is how an explanation starts lying.
 */
export function scoreRepost(c: RepostCandidate, ctx: RankingContext): RankedRepost {
  const signals: RepostSignal[] = [];
  let base = 0;

  // Relationship — the largest single term, by design. This is a recommendation
  // from a person; who the person is to you is the headline fact.
  const strength = ctx.strength.get(c.reposterId) ?? 0;
  const strengthPts = Math.round((strength / 100) * 30);
  base += strengthPts;
  if (ctx.closeFriends.has(c.reposterId)) {
    signals.push({ kind: "close_friend", weight: strengthPts + 6 });
    base += 6;
  } else if (strengthPts >= 15) {
    signals.push({ kind: "strong_tie", weight: strengthPts });
  }

  // Mutual friends, logarithmic: 0→5 in common means far more than 40→45.
  const mutuals = ctx.mutualFriends.get(c.reposterId) ?? 0;
  if (mutuals > 0) {
    const pts = Math.min(10, Math.round(Math.log2(mutuals + 1) * 3));
    base += pts;
    signals.push({ kind: "mutual_friends", weight: pts });
  }

  // Effort. A caption is the cheapest honest proxy for "this person meant it".
  if (c.hasCaption) base += 8;

  // Independent corroboration. Two people who each decided to recommend this is
  // a much stronger signal than one person deciding twice — which is why this
  // reads reposterCount (distinct people) and not a repost total.
  if (c.reposterCount > 1) {
    const pts = Math.min(12, Math.round(Math.log2(c.reposterCount) * 8));
    base += pts;
    signals.push({ kind: "many_reposters", weight: pts });
  }

  // Second degree — it travelled to reach you. Only meaningful with provenance.
  if (c.sourceRepostId) {
    base += 4;
    signals.push({ kind: "second_degree", weight: 4 });
  }

  // Shared interest, from the viewer's own deliberate engagement.
  if (c.category && ctx.interests.has(c.category)) {
    base += 8;
    signals.push({ kind: "shared_interest", weight: 8 });
  }

  // Already following the creator? You'll see their work anyway. A repost slot
  // spent on someone you already follow is a slot not spent on discovery.
  if (ctx.followedCreators.has(c.creatorId)) base -= 6;

  const score =
    Math.max(0, base) * recencyFactor(ctx.now - c.createdAt) * reputationFactor(ctx.reputation.get(c.reposterId));

  signals.sort((a, b) => b.weight - a.weight);
  return { candidate: c, score: Math.round(score * 100) / 100, signals };
}

/**
 * Apply the diversity ceilings to an already-sorted list.
 *
 * Order matters: cap AFTER scoring, so the one repost a person gets is their
 * best one rather than their most recent.
 */
export function capReposts(ranked: RankedRepost[], limits: RankingLimits = DEFAULT_LIMITS): RankedRepost[] {
  const out: RankedRepost[] = [];
  const perReposter = new Map<string, number>();
  const perCreator = new Map<string, number>();
  const seenPosts = new Set<string>();

  for (const r of ranked) {
    if (out.length >= limits.maxPerPage) break;
    const { reposterId, creatorId, postId } = r.candidate;
    // The same post reposted by three different people is still one post.
    if (seenPosts.has(postId)) continue;
    if ((perReposter.get(reposterId) ?? 0) >= limits.maxPerReposter) continue;
    if ((perCreator.get(creatorId) ?? 0) >= limits.maxPerCreator) continue;
    out.push(r);
    seenPosts.add(postId);
    perReposter.set(reposterId, (perReposter.get(reposterId) ?? 0) + 1);
    perCreator.set(creatorId, (perCreator.get(creatorId) ?? 0) + 1);
  }
  return out;
}

/**
 * Rank, then cap. The one function the feed calls.
 *
 * Exclusions happen FIRST and are not scored: a post the viewer already engaged
 * with, or dismissed, is not a low-ranked candidate — it is not a candidate.
 * Scoring it and hoping it loses would eventually surface it on a quiet day.
 */
export function rankReposts(
  candidates: readonly RepostCandidate[],
  ctx: RankingContext,
  limits: RankingLimits = DEFAULT_LIMITS,
): RankedRepost[] {
  const eligible = candidates.filter(
    (c) =>
      c.audience !== "private" &&
      !ctx.excludedPostIds.has(c.postId) &&
      !ctx.dismissedPostIds.has(c.postId),
  );
  const ranked = eligible.map((c) => scoreRepost(c, ctx));
  // Deterministic: equal scores fall back to newest, then to id, so two runs of
  // the same page never disagree about the order.
  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      b.candidate.createdAt - a.candidate.createdAt ||
      a.candidate.repostId.localeCompare(b.candidate.repostId),
  );
  return capReposts(ranked, limits);
}

/**
 * Where to splice reposts into a page of organic items, so no two land next to
 * each other and none lands first.
 *
 * The first slot is never a repost: opening a feed with someone else's
 * recommendation reads as an ad. Positions are returned in the order they
 * should be applied (ascending), each already accounting for the earlier
 * insertions.
 */
export function repostSlots(organicCount: number, repostCount: number): number[] {
  if (repostCount <= 0 || organicCount <= 0) return [];
  const slots: number[] = [];
  // Start after the first organic item, then leave at least two organic items
  // between reposts (index step of 3 accounts for the inserted row itself).
  let at = 1;
  for (let i = 0; i < repostCount; i++) {
    if (at > organicCount + i) break;
    slots.push(at);
    at += 3;
  }
  return slots;
}
