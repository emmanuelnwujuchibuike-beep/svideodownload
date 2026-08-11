/**
 * Recommendation Circle™ — recommendation reputation (Feature 15 · Part 4).
 *
 * "Users gradually build a Recommendation Reputation based on meaningful
 *  shares, watch time generated, positive engagement, creator discovery and
 *  friend satisfaction. Only high-quality recommendations receive wider
 *  distribution."
 *
 * ── Quality per recommendation, never volume ──────────────────────────────
 * Every term here is a RATIO. A member with five reposts that people actually
 * open outranks one with five hundred that nobody does. A score that rewarded
 * totals would be a leaderboard for the exact behaviour `antispam.ts` exists to
 * suppress, and it would make reposting feel like farming — the opposite of the
 * brief's "quality over quantity".
 *
 * ── Derived, never stored, never shown to anyone else ─────────────────────
 * Computed per read from counts the member's own reposts generated. There is no
 * `reputation` column, so there is no historical score to leak, no ladder to
 * climb publicly, and no API that accepts someone else's id. This follows
 * `graph/strength.ts` exactly, for the same reason: a private number stays
 * private when it does not exist between requests.
 *
 * ── "Unknown" is a real answer ────────────────────────────────────────────
 * Below the confidence floor the band is `new`, never `poor`. A member with two
 * reposts has not been judged and telling them they are a weak recommender on
 * that evidence is the app inventing a verdict out of an empty table. `new`
 * carries a NEUTRAL multiplier in ranking — it is not a penalty.
 *
 * ── What is not an input ──────────────────────────────────────────────────
 * "Watch time generated" and "friend satisfaction" from the brief have no data.
 * There is no per-viewer watch ledger keyed to a repost, and satisfaction is not
 * a thing this product measures. `open` (someone opened the post from your
 * repost) is the honest, available proxy and is named as such.
 *
 * Pure: no React, no Supabase, no I/O.
 */

export interface ReputationInput {
  /** Reposts this member has made that were publicly distributed. */
  reposts: number;
  /** Times a repost of theirs was shown to someone. */
  impressions: number;
  /** Times someone opened the post from their repost. */
  opens: number;
  /** Likes, comments and saves that happened via their repost. */
  positiveEngagements: number;
  /** Times someone reposted onward FROM their repost — the strongest signal available. */
  chainReposts: number;
  /** Times someone followed the original creator through their repost. */
  creatorFollows: number;
  /** Distinct creators they have recommended. Breadth, not volume. */
  distinctCreators: number;
}

export type ReputationBand = "new" | "emerging" | "trusted" | "exceptional";

export interface ReputationResult {
  /** 0–100. Only meaningful alongside the band. */
  score: number;
  band: ReputationBand;
  /** Whether there is enough history for the score to mean anything. */
  confident: boolean;
  /** Plain-language, safe to show its owner. */
  reasons: string[];
}

/** Below this, nothing is being measured — it is being guessed. */
const MIN_REPOSTS = 5;
const MIN_IMPRESSIONS = 20;

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

/**
 * The member's private recommendation quality.
 *
 * The weights climb with how much the action cost the other person: seeing is
 * free, opening took a tap, engaging took a decision, reposting onward put
 * their own name behind it, and following the creator changed their feed for
 * good. That ordering is the whole model — it is why this cannot be gamed by
 * reposting more, only by recommending better.
 */
export function recommendationReputation(input: ReputationInput): ReputationResult {
  const reasons: string[] = [];
  const confident = input.reposts >= MIN_REPOSTS && input.impressions >= MIN_IMPRESSIONS;

  if (!confident) {
    return {
      score: 50, // Neutral: reputationFactor() maps this to ~1.0× in ranking.
      band: "new",
      confident: false,
      reasons: ["You're just getting started — recommend a few more reels to see this."],
    };
  }

  // Open rate: did the recommendation earn a tap? 25% is strong for a feed item,
  // so that is where this term saturates rather than at an unreachable 100%.
  const openRate = ratio(input.opens, input.impressions);
  const openPts = Math.min(30, Math.round((openRate / 0.25) * 30));
  if (openRate >= 0.15) reasons.push("People open the reels you recommend.");

  // Engagement per open: what happened AFTER they arrived.
  const engageRate = ratio(input.positiveEngagements, input.opens);
  const engagePts = Math.min(25, Math.round((engageRate / 0.4) * 25));
  if (engageRate >= 0.25) reasons.push("What you recommend gets liked, saved and discussed.");

  // Onward reposts per repost — someone put their own name behind your pick.
  const chainRate = ratio(input.chainReposts, input.reposts);
  const chainPts = Math.min(20, Math.round((chainRate / 0.3) * 20));
  if (chainRate >= 0.15) reasons.push("Your recommendations travel — others repost them onward.");

  // Discovery: the creator gained an audience because of you.
  const followRate = ratio(input.creatorFollows, input.reposts);
  const followPts = Math.min(15, Math.round((followRate / 0.15) * 15));
  if (input.creatorFollows > 0) reasons.push("Creators have gained followers through your recommendations.");

  // Breadth. Recommending one creator fifty times is loyalty, not discovery, and
  // this is the term that stops the score rewarding it. Logarithmic — the step
  // from 1 to 5 creators matters, from 40 to 45 does not.
  const breadthPts = Math.min(10, Math.round(Math.log2(Math.max(1, input.distinctCreators)) * 3));
  if (input.distinctCreators >= 8) reasons.push("You recommend a wide range of creators.");

  const score = Math.max(0, Math.min(100, openPts + engagePts + chainPts + followPts + breadthPts));

  return {
    score,
    band: score >= 70 ? "exceptional" : score >= 45 ? "trusted" : "emerging",
    confident: true,
    reasons: reasons.length > 0 ? reasons : ["Your recommendations haven't caught on yet — that's normal."],
  };
}

export function bandLabel(band: ReputationBand): string {
  switch (band) {
    case "exceptional":
      return "Exceptional recommender";
    case "trusted":
      return "Trusted recommender";
    case "emerging":
      return "Emerging recommender";
    default:
      return "New recommender";
  }
}
