/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  REWARD RULES — the operator's, in one settings key (pure)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner brief "credit, referral and reward — part 1" (2026-10-07). Stored as
 * `frenzRewards` on the landing settings row, normalised on save, and read by
 * THE engine — the SQL function `process_reward_event` (migration 0187), which
 * merges each event's saved rule over `reward_default_rule(event)`. The
 * defaults below MUST equal that SQL function's (a test reads both).
 *
 * Per event:
 *   actorCredits        to the member who did it (once per source — a job, a post)
 *   referrerCredits     to whoever referred that member
 *   referrerRepeatable  false (default) = ONE referred member + ONE event = ONE reward
 *   actorOncePerUser    the actor's reward only once ever (e.g. a first subscription)
 * Every credit lands in the ONE wallet; whether it is usable or withdrawable is
 * decided by the beneficiary's qualification at that moment, never later.
 */

export const REWARD_EVENTS = [
  "account_created",
  "download_completed",
  "ai_video_completed",
  "ai_audio_completed",
  "ai_image_completed",
  "ai_avatar_completed",
  "ai_video_shared",
  "post_engagement",
  "reel_engagement",
  "profile_engagement",
  "follow",
  "save",
  "subscription_started",
  "wallet_topup",
] as const;
export type RewardEventType = (typeof REWARD_EVENTS)[number];

export const REWARD_EVENT_LABELS: Record<RewardEventType, string> = {
  account_created: "Account created",
  download_completed: "Download completed",
  ai_video_completed: "AI video generated",
  ai_audio_completed: "AI audio generated",
  ai_image_completed: "AI image generated",
  ai_avatar_completed: "AI avatar generated",
  ai_video_shared: "AI video shared to Reels",
  post_engagement: "Post engagement (like, comment)",
  reel_engagement: "Reel engagement",
  profile_engagement: "Profile engagement",
  follow: "Follow",
  save: "Save",
  subscription_started: "AI plan started",
  wallet_topup: "Credit top-up",
};

/** Events the database raises on its own (triggers) — the rest are raised by the server where they happen. Events with no source yet are listed so the operator can see them, honestly marked. */
export const REWARD_EVENT_SOURCE: Record<RewardEventType, "trigger" | "server" | "planned"> = {
  account_created: "server",
  download_completed: "trigger",
  ai_video_completed: "trigger",
  ai_audio_completed: "trigger",
  ai_image_completed: "planned",
  ai_avatar_completed: "planned",
  ai_video_shared: "server",
  post_engagement: "trigger",
  reel_engagement: "planned",
  profile_engagement: "planned",
  follow: "trigger",
  save: "trigger",
  subscription_started: "trigger",
  wallet_topup: "trigger",
};

export interface RewardRule {
  enabled: boolean;
  actorCredits: number;
  referrerCredits: number;
  referrerRepeatable: boolean;
  actorOncePerUser: boolean;
  /** ai_video_completed: which AI features count as an AI video. */
  features?: string[];
  /** ai_video_completed: whether the complimentary (free) video earns too. Owner 10-07: no. */
  includeComplimentary?: boolean;
  /** ai_video_shared: the shortest video that earns, in seconds. */
  minDurationSeconds?: number;
}

export interface RewardsConfig {
  enabled: boolean;
  events: Record<RewardEventType, RewardRule>;
  qualification: { minAccountAgeDays: number; minEngagements: number };
  /** A new member is attributed to a share link only within this many days of their account being created. */
  attribution: { windowDays: number };
  withdrawals: {
    enabled: boolean;
    /** 10 = 10 credits are worth $1. */
    creditsPerUsd: number;
    minCredits: number;
    maxCredits: number;
    maxRequestsPerDay: number;
    maxCreditsPerMonth: number;
    /** Requests above this many credits start in `reviewing` (0 = every request is reviewed). */
    manualReviewAboveCredits: number;
    methods: string[];
  };
  version: number;
  updatedAt: string | null;
}

const OFF: RewardRule = { enabled: false, actorCredits: 0, referrerCredits: 0, referrerRepeatable: false, actorOncePerUser: false };

/** 🔴 Mirrors `reward_default_rule` in supabase/migrations/0187_rewards_referrals.sql. */
export const REWARDS_DEFAULTS: RewardsConfig = {
  enabled: true,
  events: {
    ...(Object.fromEntries(REWARD_EVENTS.map((e) => [e, { ...OFF }])) as Record<RewardEventType, RewardRule>),
    ai_video_completed: { enabled: true, actorCredits: 5, referrerCredits: 5, referrerRepeatable: false, actorOncePerUser: false, features: ["ai_text_to_video", "ai_image_to_video"], includeComplimentary: false },
    ai_video_shared: { enabled: true, actorCredits: 3, referrerCredits: 0, referrerRepeatable: false, actorOncePerUser: false, minDurationSeconds: 30 },
  },
  qualification: { minAccountAgeDays: 30, minEngagements: 100 },
  attribution: { windowDays: 7 },
  withdrawals: { enabled: false, creditsPerUsd: 10, minCredits: 100, maxCredits: 10_000, maxRequestsPerDay: 1, maxCreditsPerMonth: 50_000, manualReviewAboveCredits: 0, methods: ["bank_transfer"] },
  version: 1,
  updatedAt: null,
};

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function int(v: unknown, d: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : d;
}
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);

function normalizeRule(raw: unknown, d: RewardRule): RewardRule {
  const r = isRecord(raw) ? raw : {};
  const out: RewardRule = {
    enabled: bool(r.enabled, d.enabled),
    actorCredits: int(r.actorCredits, d.actorCredits, 0, 100_000),
    referrerCredits: int(r.referrerCredits, d.referrerCredits, 0, 100_000),
    referrerRepeatable: bool(r.referrerRepeatable, d.referrerRepeatable),
    actorOncePerUser: bool(r.actorOncePerUser, d.actorOncePerUser),
  };
  if (d.features) out.features = Array.isArray(r.features) ? r.features.filter((f): f is string => typeof f === "string" && /^ai_[a-z_]{2,40}$/.test(f)).slice(0, 12) : [...d.features];
  if (d.includeComplimentary !== undefined) out.includeComplimentary = bool(r.includeComplimentary, d.includeComplimentary);
  if (d.minDurationSeconds !== undefined) out.minDurationSeconds = int(r.minDurationSeconds, d.minDurationSeconds, 1, 3600);
  return out;
}

export function normalizeRewardsConfig(raw: unknown): RewardsConfig {
  const d = REWARDS_DEFAULTS;
  const r = isRecord(raw) ? raw : {};
  const ev = isRecord(r.events) ? r.events : {};
  const q = isRecord(r.qualification) ? r.qualification : {};
  const a = isRecord(r.attribution) ? r.attribution : {};
  const w = isRecord(r.withdrawals) ? r.withdrawals : {};
  const minCredits = int(w.minCredits, d.withdrawals.minCredits, 1, 10_000_000);
  return {
    enabled: bool(r.enabled, d.enabled),
    events: Object.fromEntries(REWARD_EVENTS.map((e) => [e, normalizeRule(ev[e], d.events[e])])) as Record<RewardEventType, RewardRule>,
    qualification: { minAccountAgeDays: int(q.minAccountAgeDays, d.qualification.minAccountAgeDays, 0, 3650), minEngagements: int(q.minEngagements, d.qualification.minEngagements, 0, 1_000_000) },
    attribution: { windowDays: int(a.windowDays, d.attribution.windowDays, 1, 90) },
    withdrawals: {
      enabled: bool(w.enabled, d.withdrawals.enabled),
      creditsPerUsd: int(w.creditsPerUsd, d.withdrawals.creditsPerUsd, 1, 1_000_000),
      minCredits,
      maxCredits: Math.max(minCredits, int(w.maxCredits, d.withdrawals.maxCredits, 1, 100_000_000)),
      maxRequestsPerDay: int(w.maxRequestsPerDay, d.withdrawals.maxRequestsPerDay, 1, 100),
      maxCreditsPerMonth: int(w.maxCreditsPerMonth, d.withdrawals.maxCreditsPerMonth, 1, 1_000_000_000),
      manualReviewAboveCredits: int(w.manualReviewAboveCredits, d.withdrawals.manualReviewAboveCredits, 0, 100_000_000),
      methods: Array.isArray(w.methods) ? w.methods.filter((m): m is string => typeof m === "string" && /^[a-z_]{2,30}$/.test(m)).slice(0, 6) : [...d.withdrawals.methods],
    },
    version: int(r.version, d.version, 1, 1_000_000_000),
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : null,
  };
}

/** A save that changes any amount or rule bumps the version stamped on every reward after it. */
export function versionRewardsConfig(previous: RewardsConfig, next: RewardsConfig, now: Date = new Date()): RewardsConfig {
  const fp = (c: RewardsConfig) => JSON.stringify({ e: c.enabled, ev: c.events, q: c.qualification, a: c.attribution, w: c.withdrawals });
  if (fp(previous) === fp(next)) return { ...next, version: previous.version, updatedAt: previous.updatedAt };
  return { ...next, version: previous.version + 1, updatedAt: now.toISOString() };
}

/** Credits → US cents at the operator's rate (floor — a withdrawal never pays a fraction of a cent it did not earn). */
export function withdrawalUsdCents(credits: number, creditsPerUsd: number): number {
  return Math.floor((Math.max(0, Math.floor(credits)) * 100) / Math.max(1, creditsPerUsd));
}

/** What a browser may know: amounts and thresholds, nothing else. */
export function publicRewardsConfig(c: RewardsConfig) {
  return {
    enabled: c.enabled,
    events: Object.fromEntries(REWARD_EVENTS.filter((e) => c.events[e].enabled && (c.events[e].actorCredits > 0 || c.events[e].referrerCredits > 0)).map((e) => [e, { label: REWARD_EVENT_LABELS[e], actorCredits: c.events[e].actorCredits, referrerCredits: c.events[e].referrerCredits, minDurationSeconds: c.events[e].minDurationSeconds ?? null }])),
    qualification: c.qualification,
    withdrawals: c.withdrawals.enabled ? { creditsPerUsd: c.withdrawals.creditsPerUsd, minCredits: c.withdrawals.minCredits, maxCredits: c.withdrawals.maxCredits, methods: c.withdrawals.methods } : null,
  };
}
