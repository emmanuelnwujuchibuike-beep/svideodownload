/**
 * Achievement Platform™ (Feature 18 · Part — Achievements).
 *
 * Achievements are DERIVED from real signals, exactly like Reputation: an award
 * is "earned" only when a real metric (posts, followers, engagement, friends,
 * account age, verification, reputation) actually reaches its threshold. There
 * are no fabricated unlocks — a brand-new account sees them honestly locked, with
 * genuine progress toward each. This is the same trustworthy pattern the creator
 * rail already used for its three badges, expanded into a real catalog with
 * rarity tiers and categories.
 *
 * The persisted layers — unlock timestamps + the achievement timeline, pinning /
 * showcase, AI Memory Cards, community-issued awards, sharing and Hall of
 * Distinction — are declared next; they need their own tables and moderation. The
 * catalog + earned/locked/progress computation below is the honest core.
 */

export type Rarity = "standard" | "distinguished" | "exceptional" | "elite" | "prestigious" | "legendary";

/** Rarity → premium metallic gradient (never cartoonish). */
export const RARITY_META: Record<Rarity, { label: string; from: string; to: string }> = {
  standard: { label: "Standard", from: "#64748b", to: "#94a3b8" },
  distinguished: { label: "Distinguished", from: "#0ea5e9", to: "#22d3ee" },
  exceptional: { label: "Exceptional", from: "#10b981", to: "#34d399" },
  elite: { label: "Elite", from: "#7c3aed", to: "#a78bfa" },
  prestigious: { label: "Prestigious", from: "#f59e0b", to: "#fbbf24" },
  legendary: { label: "Legendary", from: "#f43f5e", to: "#fb7185" },
};

const RARITY_ORDER: Rarity[] = ["standard", "distinguished", "exceptional", "elite", "prestigious", "legendary"];

export interface AchievementSignals {
  accountAgeDays: number;
  posts: number;
  followers: number;
  friends: number;
  likes: number;
  views: number;
  collections: number;
  verified: boolean;
  reputationScore: number;
}

export type AchievementCategory = "Personal" | "Creator" | "Community" | "Trust" | "Anniversary";

export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  category: AchievementCategory;
  rarity: Rarity;
  iconKey: string;
  metric: (s: AchievementSignals) => number;
  target: number;
}

/** The catalog. Every entry's `metric` reads a real signal; `target` is the bar. */
const CATALOG: AchievementDef[] = [
  { id: "first-post", title: "First Steps", description: "Published your first post.", category: "Personal", rarity: "standard", iconKey: "sparkles", metric: (s) => s.posts, target: 1 },
  { id: "storyteller", title: "Storyteller", description: "Published 50 posts.", category: "Personal", rarity: "distinguished", iconKey: "layers", metric: (s) => s.posts, target: 50 },
  { id: "prolific", title: "Prolific", description: "Published 250 posts.", category: "Personal", rarity: "exceptional", iconKey: "layers", metric: (s) => s.posts, target: 250 },
  { id: "connector", title: "Connector", description: "Made 10 friends.", category: "Community", rarity: "standard", iconKey: "users", metric: (s) => s.friends, target: 10 },
  { id: "community-builder", title: "Community Builder", description: "Made 100 friends.", category: "Community", rarity: "distinguished", iconKey: "users", metric: (s) => s.friends, target: 100 },
  { id: "curator", title: "Curator", description: "Organized 5 collections.", category: "Community", rarity: "distinguished", iconKey: "bookmark", metric: (s) => s.collections, target: 5 },
  { id: "rising-voice", title: "Rising Voice", description: "Reached 100 followers.", category: "Creator", rarity: "distinguished", iconKey: "trending", metric: (s) => s.followers, target: 100 },
  { id: "trend-setter", title: "Trend Setter", description: "Reached 1,000 followers.", category: "Creator", rarity: "exceptional", iconKey: "rocket", metric: (s) => s.followers, target: 1000 },
  { id: "viral-star", title: "Viral Star", description: "Earned 100K likes.", category: "Creator", rarity: "elite", iconKey: "flame", metric: (s) => s.likes, target: 100_000 },
  { id: "top-creator", title: "Top Creator", description: "Earned 1M views.", category: "Creator", rarity: "prestigious", iconKey: "trophy", metric: (s) => s.views, target: 1_000_000 },
  { id: "verified-member", title: "Verified", description: "Your identity is verified.", category: "Trust", rarity: "elite", iconKey: "badge", metric: (s) => (s.verified ? 1 : 0), target: 1 },
  { id: "trusted-member", title: "Trusted Member", description: "Reached 1,000 reputation.", category: "Trust", rarity: "exceptional", iconKey: "shield", metric: (s) => s.reputationScore, target: 1000 },
  { id: "one-year", title: "One Year", description: "A year on Frenz.", category: "Anniversary", rarity: "distinguished", iconKey: "calendar", metric: (s) => s.accountAgeDays, target: 365 },
  { id: "veteran", title: "Veteran", description: "Five years on Frenz.", category: "Anniversary", rarity: "prestigious", iconKey: "award", metric: (s) => s.accountAgeDays, target: 1825 },
];

export interface EarnedAchievement {
  def: AchievementDef;
  earned: boolean;
  /** 0–1 progress toward the target. */
  progress: number;
  value: number;
}

/** Compute earned/locked + progress for every achievement, sorted for display:
 *  earned first (rarest first), then locked ordered by how close they are. */
export function computeAchievements(s: AchievementSignals): EarnedAchievement[] {
  return CATALOG.map((def) => {
    const value = def.metric(s);
    return { def, value, earned: value >= def.target, progress: Math.max(0, Math.min(1, value / def.target)) };
  }).sort((a, b) => {
    if (a.earned !== b.earned) return a.earned ? -1 : 1;
    if (a.earned) return RARITY_ORDER.indexOf(b.def.rarity) - RARITY_ORDER.indexOf(a.def.rarity);
    return b.progress - a.progress;
  });
}

export function earnedCount(list: EarnedAchievement[]): number {
  return list.reduce((n, a) => n + (a.earned ? 1 : 0), 0);
}
