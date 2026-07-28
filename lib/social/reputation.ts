/**
 * Reputation™ (Feature 18 · Part — Reputation Platform).
 *
 * A user's Reputation is DERIVED, transparently, from real signals the platform
 * already stores — account age, contributions, the engagement their content has
 * earned, friendships, and verification — plus one persisted admin adjustment
 * (`reputation_bonus`, migration 0097). There are no fabricated numbers: the same
 * inputs always produce the same score, and the formula below is the whole
 * definition.
 *
 * Two deliberate design choices encode the brief's "trust, not popularity"
 * philosophy:
 *  - Engagement and reach are LOG-scaled, so a single viral moment can't dominate
 *    a score built over years — a creator with steady contribution outranks one
 *    with one lucky hit.
 *  - Vanity inputs (posts, friends) are CAPPED, and account maturity + verification
 *    carry real weight, so reputation reflects consistency and trust over time.
 *
 * The persisted ledger (award/deduct history), streaks, prestige, leaderboards and
 * the celebration engine are later layers; this module is the honest, real core.
 */

export interface ReputationSignals {
  accountAgeDays: number;
  posts: number;
  followers: number;
  friends: number;
  /** Likes + comments + shares + saves the user's content has received. */
  engagementReceived: number;
  views: number;
  collections: number;
  verified: boolean;
  /** Manual admin award/penalty (migration 0097); 0 when unset/unmigrated. */
  bonus: number;
}

/** The 10 prestige ranks. Emblem colours are metallic/premium gradients, never
 *  cartoonish — slate → sky → … → prestige gold. */
export const REPUTATION_RANKS = [
  { key: "origin", name: "Origin", min: 0, from: "#64748b", to: "#94a3b8" },
  { key: "explorer", name: "Explorer", min: 120, from: "#0ea5e9", to: "#38bdf8" },
  { key: "contributor", name: "Contributor", min: 320, from: "#06b6d4", to: "#22d3ee" },
  { key: "navigator", name: "Navigator", min: 640, from: "#10b981", to: "#34d399" },
  { key: "ambassador", name: "Ambassador", min: 1050, from: "#8b5cf6", to: "#a78bfa" },
  { key: "pioneer", name: "Pioneer", min: 1650, from: "#6366f1", to: "#818cf8" },
  { key: "elite", name: "Elite", min: 2500, from: "#d946ef", to: "#e879f9" },
  { key: "visionary", name: "Visionary", min: 3600, from: "#f43f5e", to: "#fb7185" },
  { key: "luminary", name: "Luminary", min: 5000, from: "#f59e0b", to: "#fbbf24" },
  { key: "legacy", name: "Legacy", min: 7000, from: "#b45309", to: "#f59e0b" },
] as const;

export type ReputationRank = (typeof REPUTATION_RANKS)[number];

const log10 = (n: number) => Math.log10(1 + Math.max(0, n));

/** The reputation score — a transparent weighted sum of real signals. */
export function computeReputationScore(s: ReputationSignals): number {
  const maturity = (Math.min(s.accountAgeDays, 1825) / 1825) * 220; // up to 220 over 5 years
  const contribution = Math.min(s.posts, 600) * 1.4; // capped so posting alone can't run away
  const engagement = Math.floor(log10(s.engagementReceived) * 130); // log-scaled — no viral domination
  const reach = Math.floor(log10(s.views) * 60);
  const community = Math.min(s.friends, 500) * 0.8 + Math.min(s.collections, 50) * 4;
  const trust = s.verified ? 160 : 0;
  const base = maturity + contribution + engagement + reach + community + trust;
  return Math.max(0, Math.round(base + (s.bonus || 0)));
}

/** Trust Index (0–100): earned maturity + verification + healthy participation.
 *  Never purchasable — driven only by time and authentic activity. */
export function computeTrustIndex(s: ReputationSignals): number {
  const maturity = Math.min(s.accountAgeDays / 730, 1) * 45; // up to 45 over 2 years
  const verified = s.verified ? 25 : 0;
  const participation = (s.friends > 0 ? 10 : 0) + Math.min(s.posts, 5) * 2;
  const consistency = s.posts >= 20 ? 10 : 0;
  return Math.max(0, Math.min(100, Math.round(maturity + verified + participation + consistency)));
}

export interface Reputation {
  score: number;
  trustIndex: number;
  rank: ReputationRank;
  nextRank: ReputationRank | null;
  /** 0–1 progress toward the next rank (1 at the top rank). */
  progress: number;
  /** Points remaining to the next rank (0 at the top). */
  toNext: number;
}

export function computeReputation(s: ReputationSignals): Reputation {
  const score = computeReputationScore(s);
  const trustIndex = computeTrustIndex(s);

  let current: ReputationRank = REPUTATION_RANKS[0];
  for (const r of REPUTATION_RANKS) if (score >= r.min) current = r;
  const idx = REPUTATION_RANKS.findIndex((r) => r.key === current.key);
  const next: ReputationRank | null = REPUTATION_RANKS[idx + 1] ?? null;

  const progress = next ? Math.max(0, Math.min(1, (score - current.min) / (next.min - current.min))) : 1;
  const toNext = next ? Math.max(0, next.min - score) : 0;

  return { score, trustIndex, rank: current, nextRank: next, progress, toNext };
}
