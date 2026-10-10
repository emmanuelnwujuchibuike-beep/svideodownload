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

  /* ── Feature 19 Part 6 (People You May Know™) — all optional, so every older caller keeps its meaning ── */
  /** An address in the VIEWER's own contacts matched them (Part 5, privacy re-checked). The viewer's own data. */
  inContacts?: boolean;
  /** They follow the viewer. The viewer can already see this in their followers list. */
  followsViewer?: boolean;
  /** People the viewer follows who also follow them. Ranking only, unless disclosable. */
  mutualFollows?: number;
  /** Every one of those follows may be disclosed (their followers lists are public). */
  mutualFollowsDisclosable?: boolean;
  /** 0..1 overlap of the two members' interest categories. Ranking ONLY - never named, it comes from private watch history. */
  interestOverlap?: number;
  /** The profile's own public type (0107): personal, creator, business, professional, student, developer, community, organization. */
  profileType?: string;
  isVerified?: boolean;
  /** The viewer dismissed them (hide, not interested, already know) or snoozed them and the snooze has not run out. */
  dismissed?: boolean;
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
  if (c.dismissed) return false;
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

  // Part 6 signals. Contacts and "follows you" are the viewer's own real-world
  // evidence, so they weigh like several mutual friends. Mutual follows are
  // weaker than mutual friends (a follow is one-sided) and saturate sooner.
  if (c.inContacts) score += 30;
  if (c.followsViewer) score += 14;
  if (c.mutualFollows) score += Math.min(20, Math.round(Math.log2(c.mutualFollows + 1) * 7));
  if (c.interestOverlap) score += Math.round(Math.min(1, Math.max(0, c.interestOverlap)) * 10);
  if (c.isVerified) score += 2;
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
  // the viewer's own address book: the most specific true reason there is
  if (c.inContacts) return { reason: "In your contacts", disclosesMutual: false };
  if (c.mutualFriends > 0 && c.mutualsDisclosable) {
    return {
      reason: c.mutualFriends === 1 ? "1 friend in common" : `${c.mutualFriends} friends in common`,
      disclosesMutual: true,
    };
  }
  if (c.followsViewer) return { reason: "Follows you", disclosesMutual: false };
  if (c.mutualFollows && c.mutualFollows > 0 && c.mutualFollowsDisclosable) {
    return { reason: c.mutualFollows === 1 ? "Followed by someone you follow" : `Followed by ${c.mutualFollows} people you follow`, disclosesMutual: true };
  }
  if (c.sharedCircles > 0) return { reason: "Already in one of your circles", disclosesMutual: false };
  if (c.alreadyFollowing) return { reason: "You follow them", disclosesMutual: false };
  if (c.sameLocation) return { reason: "Near you", disclosesMutual: false };
  // the profile's own public type - something it says about itself
  const typeReason = c.profileType ? TYPE_REASON[c.profileType] : undefined;
  if (typeReason) return { reason: typeReason, disclosesMutual: false };
  return { reason: "Suggested for you", disclosesMutual: false };
}

const TYPE_REASON: Record<string, string> = {
  creator: "Creator on Frenz",
  business: "Business on Frenz",
  professional: "Professional on Frenz",
  developer: "Developer on Frenz",
  student: "Student on Frenz",
  community: "Community on Frenz",
  organization: "Organization on Frenz",
};

/**
 * Internal confidence (Part 6: "never shown publicly"). Used to order and to
 * decide what fills a short list. It is not returned by any API.
 */
export type SuggestionConfidence = "very_high" | "high" | "medium" | "low" | "experimental";
export function confidenceFor(score: number): SuggestionConfidence {
  return score >= 60 ? "very_high" : score >= 40 ? "high" : score >= 22 ? "medium" : score >= 10 ? "low" : "experimental";
}

/** The discovery filters. Each is a fact about the candidate, never a guess. */
export const SUGGESTION_FILTERS = ["all", "mutual", "creators", "businesses", "professionals", "verified", "nearby"] as const;
export type SuggestionFilter = (typeof SUGGESTION_FILTERS)[number];
export function isSuggestionFilter(v: unknown): v is SuggestionFilter {
  return typeof v === "string" && (SUGGESTION_FILTERS as readonly string[]).includes(v);
}
export function matchesFilter(c: SuggestionCandidate, f: SuggestionFilter): boolean {
  switch (f) {
    case "all":
      return true;
    case "mutual":
      return c.mutualFriends > 0 || !!c.inContacts || !!c.followsViewer;
    case "creators":
      return c.profileType === "creator";
    case "businesses":
      return c.profileType === "business" || c.profileType === "organization";
    case "professionals":
      return c.profileType === "professional" || c.profileType === "developer";
    case "verified":
      return !!c.isVerified;
    case "nearby":
      return c.sameLocation;
  }
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
