/**
 * People You May Know — eligibility and ranking (Feature 18 · Part 17).
 *
 * ── The leak that this feature is famous for ──────────────────────────────
 * "You may know Sarah because you both know Daniel" is a helpful sentence and
 * a disclosure. It tells the viewer that Daniel and Sarah are connected — a
 * fact from DANIEL's friend list, which Daniel may have set to private, and
 * which he certainly never agreed to have republished to strangers as a
 * recommendation footnote.
 *
 * So the reason and the ranking are separated. Mutual friends always count
 * toward the SCORE (the maths is private; the viewer sees an ordering, not the
 * inputs), but a mutual is only ever NAMED, or even counted out loud, when
 * that person's own followers/friends visibility is public. Everyone else gets
 * a true but non-disclosing reason. The suggestion stays good; the disclosure
 * stops.
 *
 * ── Eligibility fails closed ──────────────────────────────────────────────
 * `isEligible` returns false for anything it is unsure about. A suggestion is
 * a low-value feature with a high-cost failure mode: recommending a blocked
 * account, a suspended account, or someone who turned recommendations off is a
 * privacy incident, whereas a missing suggestion is nothing at all.
 *
 * Pure: no React, no Supabase, no I/O.
 */

export interface SuggestionCandidate {
  id: string;
  /** Friends in common — used for ranking whether or not it may be shown. */
  mutualFriends: number;
  /**
   * True only when the mutual connection may be disclosed: the mutual's own
   * followers visibility is public. Computed by the caller from
   * `privacy_settings.followers_visibility`; defaults to false everywhere.
   */
  mutualsDisclosable: boolean;
  /** The candidate has recommendations switched off (`show_in_recommendations`). */
  optedOut: boolean;
  isSuspended: boolean;
  isHidden: boolean;
  /** Either direction — a block in either direction disqualifies. */
  blockedEitherWay: boolean;
  /** The viewer muted or restricted them. */
  suppressedByViewer: boolean;
  alreadyFriend: boolean;
  alreadyFollowing: boolean;
  /** A pending request in either direction. */
  requestPending: boolean;
  /** Same location string as the viewer. */
  sameLocation: boolean;
  /** Circles of the viewer's this person already appears in (via another edge). */
  sharedCircles: number;
  /** The candidate's follower count — a weak popularity prior. */
  followers: number;
  /** Days since the account was created; new accounts rank lower. */
  accountAgeDays: number | null;
}

export interface ViewerContext {
  viewerId: string;
}

/**
 * May this candidate be suggested at all?
 *
 * Note `isHidden`: a hidden account is friends-only (migration 0082), so
 * suggesting it to a stranger would surface an account whose entire point is
 * being invisible to strangers.
 */
export function isEligible(c: SuggestionCandidate, ctx: ViewerContext): boolean {
  if (!c.id || c.id === ctx.viewerId) return false;
  if (c.blockedEitherWay) return false;
  if (c.suppressedByViewer) return false;
  if (c.isSuspended || c.isHidden) return false;
  if (c.optedOut) return false;
  if (c.alreadyFriend) return false;
  if (c.requestPending) return false;
  return true;
}

export interface ScoredSuggestion {
  id: string;
  score: number;
  /** Safe to render. Never names or counts a mutual unless disclosable. */
  reason: string;
  /** True when `reason` discloses a mutual connection. */
  disclosesMutual: boolean;
}

/**
 * Rank a candidate. Higher is a better suggestion.
 *
 * Mutual friends dominate because they are the only signal that actually
 * predicts a real-world connection. Popularity is capped low and deliberately
 * logarithmic — otherwise every member is recommended the same twenty large
 * accounts, which is a leaderboard, not a suggestion.
 */
export function scoreSuggestion(c: SuggestionCandidate): number {
  let score = 0;

  // Strong, saturating: 10 mutuals is a lot; 40 is not four times as much.
  score += Math.min(50, Math.round(Math.log2(c.mutualFriends + 1) * 16));

  if (c.sharedCircles > 0) score += Math.min(12, c.sharedCircles * 6);
  if (c.sameLocation) score += 10;
  if (c.alreadyFollowing) score += 8; // already interested — a friendship is plausible

  score += Math.min(8, Math.round(Math.log10(Math.max(1, c.followers)) * 2));

  // Brand-new accounts sink. Not a judgement — it is the cheapest way to keep
  // freshly created spam accounts out of everyone's suggestions.
  if (c.accountAgeDays != null && c.accountAgeDays < 7) score -= 15;

  return Math.max(0, score);
}

/**
 * The sentence shown under a suggestion.
 *
 * Order matters: the most specific TRUE and PERMITTED reason wins. When the
 * mutual-friend reason is not permitted, the fallbacks are still honest — they
 * simply describe something the viewer already knows or that is public.
 */
export function reasonFor(c: SuggestionCandidate): { reason: string; disclosesMutual: boolean } {
  if (c.mutualFriends > 0 && c.mutualsDisclosable) {
    return {
      reason: c.mutualFriends === 1 ? "1 friend in common" : `${c.mutualFriends} friends in common`,
      disclosesMutual: true,
    };
  }
  if (c.sharedCircles > 0) return { reason: "Already in one of your circles", disclosesMutual: false };
  if (c.alreadyFollowing) return { reason: "You follow them", disclosesMutual: false };
  if (c.sameLocation) return { reason: "Near you", disclosesMutual: false };
  return { reason: "Suggested for you", disclosesMutual: false };
}

/** Eligibility + score + reason, sorted, capped. The one function callers need. */
export function rankSuggestions(
  candidates: readonly SuggestionCandidate[],
  ctx: ViewerContext,
  limit = 20,
): ScoredSuggestion[] {
  return candidates
    .filter((c) => isEligible(c, ctx))
    .map((c) => {
      const { reason, disclosesMutual } = reasonFor(c);
      return { id: c.id, score: scoreSuggestion(c), reason, disclosesMutual };
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, limit));
}
