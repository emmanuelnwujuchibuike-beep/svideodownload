/**
 * Followers™ — who may follow you, and how fast anyone may follow (Feature 19 · Part 3).
 *
 * Pure: the browser (labels) and the server (lib/social/follows.ts) share it,
 * and the tests here are the specification. Following is interest, not trust —
 * so the default stays "everyone", today's behaviour, and every narrower choice
 * is the account owner's to make.
 */

/** privacy_settings.follow_policy (0217). */
export const FOLLOW_POLICIES = ["everyone", "friends_of_friends", "verified", "friends", "approval", "nobody"] as const;
export type FollowPolicy = (typeof FOLLOW_POLICIES)[number];

export const FOLLOW_POLICY_LABELS: Record<FollowPolicy, string> = {
  everyone: "Everyone",
  friends_of_friends: "Friends of friends",
  verified: "Verified accounts",
  friends: "Friends only",
  approval: "Only people I approve",
  nobody: "Nobody",
};

export function isFollowPolicy(v: unknown): v is FollowPolicy {
  return typeof v === "string" && (FOLLOW_POLICIES as readonly string[]).includes(v);
}

export type FollowDecision = "follow" | "request" | "refuse";

/**
 * What a follow attempt becomes under the target's policy. A friend may always
 * follow (a friendship is the stronger tie), except under "nobody". "approval"
 * turns every other follow into a request the target answers.
 */
export function followDecision(policy: string | null | undefined, viewer: { isFriend: boolean; mutualFriends: number; verified: boolean }): FollowDecision {
  const p: FollowPolicy = isFollowPolicy(policy) ? policy : "everyone";
  if (p === "nobody") return "refuse";
  if (p === "everyone" || viewer.isFriend) return "follow";
  if (p === "approval") return "request";
  if (p === "friends") return "refuse";
  if (p === "verified") return viewer.verified ? "follow" : "refuse";
  return viewer.mutualFriends > 0 ? "follow" : "refuse";
}

/** Where a follow came from (follows.source / follow_requests.source, 0217) — counted for the owner, never who. */
export const FOLLOW_SOURCES = ["profile", "search", "suggestion", "feed", "reels", "qr", "request", "other"] as const;
export type FollowSource = (typeof FOLLOW_SOURCES)[number];
export function isFollowSource(v: unknown): v is FollowSource {
  return typeof v === "string" && (FOLLOW_SOURCES as readonly string[]).includes(v);
}

export const FOLLOW_SOURCE_LABELS: Record<FollowSource, string> = {
  profile: "Your profile",
  search: "Search",
  suggestion: "Suggestions",
  feed: "Feed",
  reels: "Reels",
  qr: "QR code",
  request: "Approved requests",
  other: "Elsewhere",
};

/* ─────────────────────── Smart Unfollow / anti-automation ─────────────────────── */

/** No person follows 60 accounts an hour or 200 a day; a week-old account, 50 a day. Bots do. */
export const FOLLOWS_PER_HOUR = 60;
export const FOLLOWS_PER_DAY = 200;
export const FOLLOWS_PER_DAY_NEW = 50;
export const NEW_ACCOUNT_DAYS = 7;

export function followAllowance(f: { accountAgeDays: number; followsLastHour: number; followsLastDay: number }): { ok: true } | { ok: false; reason: "hourly" | "daily" } {
  if (f.followsLastHour >= FOLLOWS_PER_HOUR) return { ok: false, reason: "hourly" };
  const day = f.accountAgeDays < NEW_ACCOUNT_DAYS ? FOLLOWS_PER_DAY_NEW : FOLLOWS_PER_DAY;
  if (f.followsLastDay >= day) return { ok: false, reason: "daily" };
  return { ok: true };
}

/* ───────────────────────────── Audience Intelligence ──────────────────────────── */

export interface FollowerDay {
  day: string;
  gained: number;
  lost: number;
}

/** Follower flow over the last `days` days, from follower_daily rows (any order, gaps allowed). */
export function followerFlow(rows: readonly FollowerDay[], days: number, today: string): { gained: number; lost: number; net: number } {
  const start = Date.parse(`${today}T00:00:00Z`) - (days - 1) * 86_400_000;
  let gained = 0;
  let lost = 0;
  for (const r of rows) {
    if (Date.parse(`${r.day}T00:00:00Z`) < start) continue;
    gained += r.gained;
    lost += r.lost;
  }
  return { gained, lost, net: gained - lost };
}

/**
 * Follow sources as shares, with small groups folded away: a source with fewer
 * than MIN_SOURCE_COHORT followers is not shown on its own (a count of 1 or 2
 * from "QR code" can point at a specific person).
 */
export const MIN_SOURCE_COHORT = 5;
export function sourceBreakdown(counts: Readonly<Record<string, number>>): { source: FollowSource; count: number; share: number }[] {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return [];
  return Object.entries(counts)
    .filter(([s, n]) => isFollowSource(s) && n >= MIN_SOURCE_COHORT)
    .map(([s, n]) => ({ source: s as FollowSource, count: n, share: n / total }))
    .sort((a, b) => b.count - a.count);
}
