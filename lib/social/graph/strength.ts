/**
 * Relationship Intelligence™ — connection strength (Feature 18 · Part 17).
 *
 * ── The line this module refuses to cross ─────────────────────────────────
 * "Relationship health" and "interaction trends" are one design decision away
 * from being a surveillance product. The version that would be easy to build
 * reads what the OTHER person did — did they open your message, did they view
 * your profile, have they stopped watching your stories — and reports it back
 * as a score. That turns a social app into an instrument for monitoring
 * someone, and the people it hurts most are the ones already being monitored.
 *
 * So every input here is something the viewer ALREADY HAS. Their own messages.
 * Their own likes. A friendship they are half of. A mutual-friend count they
 * could count by hand. There is deliberately no field on `StrengthInput` for
 * the other person's behaviour, and there must never be one — the absence is
 * the safeguard, because a field that does not exist cannot be quietly
 * populated by a future caller.
 *
 * ── "Unknown" is a real answer ────────────────────────────────────────────
 * Part 15 established that reach is not a signal. The same discipline applies
 * here: with no interaction history at all, the band is `unknown`, never
 * `dormant`. A brand-new friendship has not gone quiet — nothing has happened
 * yet. Scoring silence as decay would have the app telling a member their week-
 * old friendship is dying.
 *
 * ── Nothing here is ever shown to the other person ────────────────────────
 * The score is private to the viewer, is not stored (it is derived per read),
 * and has no API that accepts a subject id from anyone but the owner.
 *
 * Pure: no React, no Supabase, no I/O.
 */

export interface StrengthInput {
  /** Mutual, agreed friendship. */
  isFriend: boolean;
  /** The viewer follows them. */
  isFollowing: boolean;
  /** They follow the viewer — a public fact either way. */
  followsBack: boolean;
  /** The viewer's own private pin. */
  isFavorite: boolean;
  /** Circles of the viewer's that this person is in. */
  sharedCircles: number;
  /** Friends in common. Both parties could count this themselves. */
  mutualFriends: number;
  /**
   * Days since the last message in THEIR conversation — a thread the viewer is
   * a participant in. Null when they have never messaged.
   */
  daysSinceMessage: number | null;
  /**
   * Days since the VIEWER last engaged with something this person posted
   * (their own like, comment or reshare). Null when they never have.
   *
   * Note the direction: this is the viewer's activity, not the other person's.
   */
  daysSinceViewerEngaged: number | null;
  /** Days since the friendship or follow began. Null when unknown. */
  daysKnown: number | null;
}

export type StrengthBand = "close" | "active" | "steady" | "quiet" | "unknown";

export interface StrengthResult {
  /** 0–100. Only meaningful alongside the band. */
  score: number;
  band: StrengthBand;
  /** Plain-language reasons, safe to show the viewer. Never mentions the other person's behaviour. */
  reasons: string[];
}

/** Anything older than this stops counting as recent contact. */
const RECENT_DAYS = 14;
const WARM_DAYS = 60;
const QUIET_DAYS = 120;

function recencyPoints(days: number | null, max: number): number {
  if (days == null) return 0;
  if (days <= RECENT_DAYS) return max;
  if (days <= WARM_DAYS) return Math.round(max * 0.6);
  if (days <= QUIET_DAYS) return Math.round(max * 0.3);
  return 0;
}

/**
 * How connected the viewer is to this person, from the viewer's side only.
 *
 * The weights favour things that took effort and mutual consent — a
 * conversation, a friendship, a deliberate favourite — over things that are
 * cheap or one-sided. A follow is worth very little on purpose: following ten
 * thousand accounts should not produce ten thousand "strong" relationships.
 */
export function relationshipStrength(input: StrengthInput): StrengthResult {
  const reasons: string[] = [];
  let score = 0;

  if (input.isFriend) {
    score += 25;
    reasons.push("You're friends");
  } else if (input.isFollowing && input.followsBack) {
    score += 10;
    reasons.push("You follow each other");
  } else if (input.isFollowing) {
    score += 4;
  }

  if (input.isFavorite) {
    score += 10;
    reasons.push("You marked them a favourite");
  }

  const messagePts = recencyPoints(input.daysSinceMessage, 30);
  score += messagePts;
  if (messagePts >= 18) reasons.push("You've talked recently");

  const engagePts = recencyPoints(input.daysSinceViewerEngaged, 15);
  score += engagePts;
  if (engagePts >= 9) reasons.push("You've been engaging with their posts");

  if (input.sharedCircles > 0) {
    score += Math.min(10, input.sharedCircles * 5);
    reasons.push(input.sharedCircles === 1 ? "In one of your circles" : `In ${input.sharedCircles} of your circles`);
  }

  if (input.mutualFriends > 0) {
    // Logarithmic: the difference between 0 and 5 mutuals means far more than
    // the difference between 40 and 45.
    score += Math.min(10, Math.round(Math.log2(input.mutualFriends + 1) * 3));
    reasons.push(input.mutualFriends === 1 ? "1 friend in common" : `${input.mutualFriends} friends in common`);
  }

  // A long-standing connection is worth something even when it's quiet.
  if (input.daysKnown != null && input.daysKnown >= 365) {
    score += 5;
    const years = Math.floor(input.daysKnown / 365);
    reasons.push(years === 1 ? "Connected for a year" : `Connected for ${years} years`);
  }

  score = Math.max(0, Math.min(100, score));
  return { score, band: bandFor(input, score), reasons };
}

/**
 * The band is NOT a simple threshold on the score, because the score cannot
 * distinguish "no history" from "history that ended" — and those two deserve
 * opposite treatment.
 */
function bandFor(input: StrengthInput, score: number): StrengthBand {
  const everInteracted = input.daysSinceMessage != null || input.daysSinceViewerEngaged != null;
  if (!everInteracted && !input.isFavorite && input.sharedCircles === 0) {
    // Nothing has happened yet. That is not decay, and calling it "quiet"
    // would be the app inventing a problem out of an empty table.
    return "unknown";
  }

  const lastContact = Math.min(input.daysSinceMessage ?? Infinity, input.daysSinceViewerEngaged ?? Infinity);
  if (lastContact > QUIET_DAYS) return "quiet";
  // 55 lands exactly on "a friend you have spoken to in the last fortnight",
  // which is the honest definition of close and the strongest pair of signals
  // this module is allowed to see. A higher bar would have required a
  // favourite or a circle on top, making "close" a description of how much
  // filing a member has done rather than of the relationship.
  if (score >= 55) return "close";
  if (score >= 35) return "active";
  return "steady";
}

export function bandLabel(band: StrengthBand): string {
  switch (band) {
    case "close":
      return "Close";
    case "active":
      return "Active";
    case "steady":
      return "Steady";
    case "quiet":
      return "Quiet";
    default:
      return "New";
  }
}

// ── Reconnect ─────────────────────────────────────────────────────────────

export interface ReconnectInput extends StrengthInput {
  /** The viewer muted, restricted or blocked them. */
  isSuppressed: boolean;
}

/**
 * Should the app suggest getting back in touch?
 *
 * Four conditions, each of which exists to stop a specific bad prompt:
 *
 *  · Must be an agreed friendship — otherwise the app nudges people toward
 *    accounts that never agreed to hear from them, which is what a growth
 *    hack looks like from the receiving end.
 *  · Must have interacted before — you cannot RE-connect with someone you
 *    never connected with. Without this the feature becomes cold outreach.
 *  · Must actually be quiet. Suggesting a reconnect with someone you messaged
 *    yesterday is how a member learns to ignore every prompt the app makes.
 *  · Must not be suppressed. Someone who muted a friend has already answered
 *    this question, and re-asking is the app overruling them.
 */
export function shouldSuggestReconnect(input: ReconnectInput): boolean {
  if (input.isSuppressed) return false;
  if (!input.isFriend) return false;
  const everInteracted = input.daysSinceMessage != null || input.daysSinceViewerEngaged != null;
  if (!everInteracted) return false;
  const lastContact = Math.min(input.daysSinceMessage ?? Infinity, input.daysSinceViewerEngaged ?? Infinity);
  return lastContact > QUIET_DAYS;
}
