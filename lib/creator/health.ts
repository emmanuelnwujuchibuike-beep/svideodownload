/**
 * Creator Health™ (Feature 15 · Part 9) — six pillars over a creator's own
 * measured behaviour.
 *
 * ── Why this is not lib/profile/health.ts ────────────────────────────────
 * That file scores profile COMPLETENESS: is there an avatar, is MFA on, is the
 * privacy review done. It is a setup checklist and it finishes. This scores a
 * PRACTICE — whether someone is publishing sustainably and whether their
 * audience is responding — and it never finishes. Different question, different
 * inputs, deliberately a separate module rather than six more pillars bolted
 * onto a file about security settings.
 *
 * ── The one pillar designed to say "do less" ─────────────────────────────
 * `burnout` is inverted on purpose. Every other number in a creator dashboard
 * rewards more: more posts, more views, more engagement. A rising upload rate
 * against falling engagement is the shape of someone working harder for less,
 * and the honest response is to name it and suggest slowing down — not to
 * congratulate the upload count. It is the only metric in this product that can
 * recommend reducing output.
 *
 * ── Honesty rules that shaped the maths ──────────────────────────────────
 * Satisfaction is scored against the CREATOR'S OWN baseline, never a global
 * one. There is no cross-creator benchmark in this product ("you're in the top
 * 10% of creators" would need a distribution nothing computes), so the
 * comparison is you-against-you, which is both computable and more useful.
 * Any pillar without enough data returns `null` and is excluded from the score
 * rather than counted as zero — an absent measurement is not a bad one.
 *
 * Pure: no React, no Supabase, no clock beyond what is passed in.
 */

export type CreatorPillarKey =
  | "consistency"
  | "satisfaction"
  | "community"
  | "growth"
  | "diversity"
  | "burnout";

export interface CreatorHealthSignals {
  /** Posts published in each of the last 8 weeks, most recent week FIRST. */
  weeklyPosts: number[];
  /** Engagement (likes+comments+shares+saves) per view over the recent window. */
  recentEngagementRate: number;
  /** The same rate over the creator's whole history — their own baseline. */
  lifetimeEngagementRate: number;
  /** Share of comments on their posts they have replied to (0-1). */
  replyRate: number;
  /** Comments received in the window — below a floor, replyRate says nothing. */
  commentsReceived: number;
  /** Follower count now, and 30 days ago (null when there is no history yet). */
  followersNow: number;
  followers30dAgo: number | null;
  /** How many distinct categories the recent posts span, and how many exist. */
  categoriesUsed: number;
  categoriesAvailable: number;
  /** Total posts published, ever. Gates pillars that need a track record. */
  totalPosts: number;
}

export type CreatorBand = "at-risk" | "building" | "steady" | "strong" | "thriving";

export interface CreatorPillar {
  key: CreatorPillarKey;
  label: string;
  /** 0-100, or null when there is not enough data to score it honestly. */
  score: number | null;
  /** What the number is actually saying, in the creator's own terms. */
  detail: string;
}

export interface CreatorHealth {
  /** Mean of the scored pillars, or null when none could be scored. */
  score: number | null;
  band: CreatorBand | null;
  pillars: CreatorPillar[];
  /** Ordered worst-first; empty when everything scored well. */
  suggestions: { pillar: CreatorPillarKey; title: string; body: string }[];
}

const LABEL: Record<CreatorPillarKey, string> = {
  consistency: "Upload consistency",
  satisfaction: "Audience satisfaction",
  community: "Community engagement",
  growth: "Follower growth",
  diversity: "Content diversity",
  burnout: "Sustainable pace",
};

/** Below this many comments, a reply rate is a rounding artefact. */
const MIN_COMMENTS_FOR_REPLY_RATE = 5;
/** Below this many posts, "diversity" and "satisfaction" have nothing to say. */
const MIN_POSTS_FOR_PATTERN = 5;

export const CREATOR_BAND_LABEL: Record<CreatorBand, string> = {
  "at-risk": "At risk",
  building: "Building",
  steady: "Steady",
  strong: "Strong",
  thriving: "Thriving",
};

export function creatorBand(score: number): CreatorBand {
  if (score < 30) return "at-risk";
  if (score < 50) return "building";
  if (score < 70) return "steady";
  if (score < 85) return "strong";
  return "thriving";
}

const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

/** Weeks in the window that had at least one post. */
function activeWeeks(weekly: number[]): number {
  return weekly.filter((n) => n > 0).length;
}

/**
 * Consistency rewards SHOWING UP, not volume: eight weeks with one post each
 * scores higher than one week with eight posts and seven silent ones, because
 * that is what an audience actually experiences. Volume is already counted by
 * every other number on the dashboard.
 */
function scoreConsistency(weekly: number[]): CreatorPillar {
  if (weekly.length === 0) {
    return { key: "consistency", label: LABEL.consistency, score: null, detail: "No history yet." };
  }
  const active = activeWeeks(weekly);
  const score = clamp((active / weekly.length) * 100);
  return {
    key: "consistency",
    label: LABEL.consistency,
    score,
    detail: `Published in ${active} of the last ${weekly.length} weeks.`,
  };
}

/**
 * Satisfaction: recent engagement rate against the creator's own lifetime rate.
 * Parity scores 70 — holding your own standard is good, not average — and
 * beating it by half again tops out.
 */
function scoreSatisfaction(s: CreatorHealthSignals): CreatorPillar {
  if (s.totalPosts < MIN_POSTS_FOR_PATTERN || s.lifetimeEngagementRate <= 0) {
    return {
      key: "satisfaction",
      label: LABEL.satisfaction,
      score: null,
      detail: "Needs a few more posts before there's a baseline to compare against.",
    };
  }
  const ratio = s.recentEngagementRate / s.lifetimeEngagementRate;
  const score = clamp(ratio >= 1 ? 70 + Math.min(30, (ratio - 1) * 60) : ratio * 70);
  const direction = ratio >= 1.05 ? "above" : ratio <= 0.95 ? "below" : "in line with";
  return {
    key: "satisfaction",
    label: LABEL.satisfaction,
    score,
    detail: `Recent engagement is ${direction} your own average.`,
  };
}

function scoreCommunity(s: CreatorHealthSignals): CreatorPillar {
  if (s.commentsReceived < MIN_COMMENTS_FOR_REPLY_RATE) {
    return {
      key: "community",
      label: LABEL.community,
      score: null,
      detail: "Not enough comments yet to measure replies.",
    };
  }
  return {
    key: "community",
    label: LABEL.community,
    score: clamp(s.replyRate * 100),
    detail: `You've replied to ${Math.round(s.replyRate * 100)}% of comments.`,
  };
}

/**
 * Growth is scored on RATE, not size, so a creator going 10 → 15 is not ranked
 * beneath one going 100,000 → 100,010. Holding steady scores 50: flat is not a
 * failure, and a dashboard that says it is teaches people to chase numbers.
 */
function scoreGrowth(s: CreatorHealthSignals): CreatorPillar {
  if (s.followers30dAgo === null) {
    return {
      key: "growth",
      label: LABEL.growth,
      score: null,
      detail: "Growth needs at least a month of daily readings — yours are still building.",
    };
  }
  const gained = s.followersNow - s.followers30dAgo;
  if (s.followers30dAgo === 0) {
    return {
      key: "growth",
      label: LABEL.growth,
      score: gained > 0 ? 75 : 40,
      detail: gained > 0 ? `${gained} new followers this month — your first.` : "No followers yet.",
    };
  }
  const rate = gained / s.followers30dAgo;
  const score = clamp(50 + rate * 250);
  return {
    key: "growth",
    label: LABEL.growth,
    score,
    detail:
      gained === 0
        ? "Follower count held steady this month."
        : `${gained > 0 ? "+" : ""}${gained} followers over 30 days.`,
  };
}

function scoreDiversity(s: CreatorHealthSignals): CreatorPillar {
  if (s.totalPosts < MIN_POSTS_FOR_PATTERN || s.categoriesAvailable === 0) {
    return { key: "diversity", label: LABEL.diversity, score: null, detail: "Too few posts to read a pattern." };
  }
  // Four categories is a healthy spread; more is not better, so the scale tops
  // out there rather than rewarding someone for touching all thirteen.
  const score = clamp((Math.min(4, s.categoriesUsed) / 4) * 100);
  return {
    key: "diversity",
    label: LABEL.diversity,
    score,
    detail: `Your recent work spans ${s.categoriesUsed} ${s.categoriesUsed === 1 ? "category" : "categories"}.`,
  };
}

/**
 * Burnout risk, inverted so that a HIGH score means a sustainable pace.
 *
 * Two signals, both needed: output climbing sharply against the creator's own
 * recent norm, AND engagement falling against their own baseline. Either alone
 * is unremarkable — a burst of posting during a good week is fine, and a soft
 * fortnight of engagement happens. Together they are the shape of someone
 * spending more to get less.
 */
function scoreBurnout(s: CreatorHealthSignals): CreatorPillar {
  if (s.weeklyPosts.length < 4 || s.totalPosts < MIN_POSTS_FOR_PATTERN) {
    return { key: "burnout", label: LABEL.burnout, score: null, detail: "Needs a month of history." };
  }
  const recent = s.weeklyPosts.slice(0, 2);
  const earlier = s.weeklyPosts.slice(2);
  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const earlierAvg = earlier.reduce((a, b) => a + b, 0) / earlier.length;

  const outputClimb = earlierAvg > 0 ? recentAvg / earlierAvg : recentAvg > 0 ? 2 : 1;
  const engagementFall =
    s.lifetimeEngagementRate > 0 ? s.recentEngagementRate / s.lifetimeEngagementRate : 1;

  // Sustainable by default. Penalty only where both signals point the same way.
  let score = 100;
  if (outputClimb > 1.5 && engagementFall < 0.9) {
    const strain = Math.min(2, outputClimb - 1) * (1 - Math.max(0.4, engagementFall));
    score = clamp(100 - strain * 130);
  } else if (outputClimb > 2.5) {
    // A very sharp climb is worth flagging gently even when engagement holds.
    score = 75;
  }

  return {
    key: "burnout",
    label: LABEL.burnout,
    score,
    detail:
      score >= 85
        ? "Your pace looks sustainable."
        : score >= 60
          ? "You've sped up recently — worth watching."
          : "You're posting much more for less response than usual.",
  };
}

const SUGGESTION: Record<CreatorPillarKey, { title: string; body: string }> = {
  consistency: {
    title: "Show up more regularly",
    body: "A steady rhythm reaches people better than bursts. One post in a quiet week counts for more than five in a busy one.",
  },
  satisfaction: {
    title: "Look at what worked before",
    body: "Recent posts are landing below your own average. Your top posts are on the content page — the pattern is usually in the first three seconds.",
  },
  community: {
    title: "Answer the questions waiting for you",
    body: "Unanswered comments are in the Creator Lounge. Replying is the cheapest engagement there is, and it compounds.",
  },
  growth: {
    title: "Give people a reason to follow",
    body: "Views without follows usually means the post landed but the profile didn't. A pinned post and a clear bio do most of that work.",
  },
  diversity: {
    title: "Try an adjacent topic",
    body: "Everything you post sits in a narrow band. One post outside it tells the discovery engine who else might want you.",
  },
  burnout: {
    title: "It's fine to slow down",
    body: "You're publishing more than usual and getting less back. Fewer, better posts will out-perform this, and the algorithm does not punish a quiet week.",
  },
};

/** Pillars scoring below this generate a suggestion. */
const SUGGEST_BELOW = 60;

export function computeCreatorHealth(s: CreatorHealthSignals): CreatorHealth {
  const pillars: CreatorPillar[] = [
    scoreConsistency(s.weeklyPosts),
    scoreSatisfaction(s),
    scoreCommunity(s),
    scoreGrowth(s),
    scoreDiversity(s),
    scoreBurnout(s),
  ];

  const scored = pillars.filter((p): p is CreatorPillar & { score: number } => p.score !== null);
  const score =
    scored.length > 0 ? Math.round(scored.reduce((sum, p) => sum + p.score, 0) / scored.length) : null;

  const suggestions = scored
    .filter((p) => p.score < SUGGEST_BELOW)
    .sort((a, b) => a.score - b.score)
    .map((p) => ({ pillar: p.key, ...SUGGESTION[p.key] }));

  return { score, band: score === null ? null : creatorBand(score), pillars, suggestions };
}
