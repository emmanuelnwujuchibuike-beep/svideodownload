import { normalizePayoutRoute, type PayoutRoute } from "@/lib/rewards/payout-rail";
import { normalizeQuests, QUESTS_DEFAULTS, type QuestsConfig } from "@/lib/rewards/quests";

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
  /**
   * What a member must meet to APPLY for withdrawals (0191: an admin then
   * reviews). Age and engagements are checked by the server (0 = not required);
   * `extraRequirements` are the operator's own lines (owner 2026-10-07: "should
   * be able to be changed, added or rewritten from admin"), shown to members and
   * checked by the team at review.
   */
  qualification: { minAccountAgeDays: number; minEngagements: number; extraRequirements: string[] };
  /** A new member is attributed to a share link only within this many days of their account being created. */
  attribution: { windowDays: number };
  /** 0192: daily and weekly quests (lib/rewards/quests.ts) — counted and paid by the SQL engine. */
  quests: QuestsConfig;
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
    /**
     * 0202 (owner, 2026-10-09): the part of a withdrawal that came from a DEPOSIT
     * is paid at its own rate, less its own fee. The rest uses `creditsPerUsd`.
     */
    deposited: { creditsPerUsd: number; feePercent: number };
  };
  /**
   * 0227 (owner brief 2026-10-11): SUB — paid subscriptions in money, never AI credits.
   * The subscriber pays the creator's price plus `purchaseFeePercent`; a SUB
   * withdrawal pays out less `withdrawalFeePercent`. Owner: SUB money from a
   * verified Paystack payment is withdrawable at once (`holdDays` 0), paid straight
   * through Paystack (`autoPayout`), without the reward qualification
   * (`requireQualification` false) — each one an admin switch.
   */
  sub: SubConfig;
  /**
   * 0255 Rewards v2 (owner, 2026-10-16): "Get 100 followers 5 credits, 1k followers 50 credits".
   * Counted on REAL followers only (real_follower_count): not suspended or hidden, a confirmed email,
   * at least `minAccountAgeDays` old. Each milestone pays once.
   */
  followers: { enabled: boolean; minAccountAgeDays: number; milestones: { followers: number; credits: number }[] };
  /**
   * 0255: "above 5k followers ... an affiliate programme where they gain 10% from any users transaction
   * they bring". An admin approves a member with at least `minFollowers` real followers; from then on
   * `rateBp` (1000 = 10%) of every payment by a member they invited (top-ups, AI plans, ads — never
   * private-post subscriptions) is paid to them as WITHDRAWABLE credits.
   */
  affiliate: { enabled: boolean; rateBp: number; minFollowers: number };
  /** 0255: the weekly top-3 AI prizes (lib/ai/weekly-top.ts) — off under Rewards v2. */
  weeklyPrizes: { enabled: boolean };
  /** 0255 set the v2 rules once; never re-applied over the admin's later changes. */
  rulesV2Applied: boolean;
  version: number;
  updatedAt: string | null;
}

const OFF: RewardRule = { enabled: false, actorCredits: 0, referrerCredits: 0, referrerRepeatable: false, actorOncePerUser: false };

/** 🔴 Mirrors `reward_default_rule` in supabase/migrations/0187_rewards_referrals.sql. */
export interface SubConfig {
  /** new subscriptions can be bought */
  purchasesEnabled: boolean;
  /** SUB money can be withdrawn */
  withdrawalsEnabled: boolean;
  purchaseFeePercent: number;
  withdrawalFeePercent: number;
  minPriceCents: number;
  maxPriceCents: number;
  minWithdrawalCents: number;
  /** days a verified payment stays pending before it can be withdrawn (0 = at once) */
  holdDays: number;
  /** days of access one payment buys */
  periodDays: number;
  /** pay SUB withdrawals through Paystack the moment they are requested */
  autoPayout: boolean;
  /** require the admin-approved reward qualification for SUB withdrawals */
  requireQualification: boolean;
  /** a light watermark (the viewer's @handle and Frenz) over subscriber-only media; never alters the file */
  watermark: boolean;
  /**
   * The flat fee on EVERY withdrawal — private-post money and AI credits alike (owner, 2026-10-17:
   * "add an additional flat $0.2 fee for every withdraw … below $300; above, 0.5; above 500, $1").
   * Charged ON TOP of the amount withdrawn (the balance must cover amount + flat fee), beside the
   * percentage fee. Tiered by the amount withdrawn in USD cents.
   */
  flatFees: WithdrawalFlatFees;
  /**
   * Which provider sends Exclusive withdrawals — one clean path, the admin's (owner, 2026-10-29; lib/rewards/payout-rail.ts
   * PAYOUT_ROUTES): Flutterwave only (the default), Paystack only, or Flutterwave with Paystack as the backup.
   */
  payoutProvider: PayoutRoute;
  /**
   * Fraud gates on the INSTANT payout (owner, 2026-10-24: "make sure the withdrawal is fully secured and gated"). A
   * withdrawal that misses any of them is still accepted, but waits for an admin instead of leaving at once:
   * the bank account must be verified at least `newAccountHoldHours` ago, one withdrawal at most
   * `autoPayoutMaxCents`, and the last 24 hours' instant payouts at most `autoPayoutDailyMaxCents`.
   */
  autoPayoutMaxCents: number;
  autoPayoutDailyMaxCents: number;
  newAccountHoldHours: number;
}

/** The tiers: below `midFromCents` → `underCents`; up to and including `overAboveCents` → `midCents`; above → `overCents`. */
export interface WithdrawalFlatFees {
  underCents: number;
  midCents: number;
  overCents: number;
  midFromCents: number;
  overAboveCents: number;
}

export const FLAT_FEE_DEFAULTS: WithdrawalFlatFees = { underCents: 20, midCents: 50, overCents: 100, midFromCents: 30_000, overAboveCents: 50_000 };

/** The flat fee for withdrawing `amountCents` (USD cents): $0.20 below $300, $0.50 from $300 to $500, $1.00 above $500 by default. */
export function withdrawalFlatFeeCents(amountCents: number, f: WithdrawalFlatFees): number {
  const a = Math.max(0, Math.floor(amountCents));
  return a < f.midFromCents ? f.underCents : a <= f.overAboveCents ? f.midCents : f.overCents;
}

export function normalizeFlatFees(raw: unknown): WithdrawalFlatFees {
  const d = FLAT_FEE_DEFAULTS;
  const r = isRecord(raw) ? raw : {};
  const midFromCents = int(r.midFromCents, d.midFromCents, 1, 100_000_000);
  return {
    underCents: int(r.underCents, d.underCents, 0, 100_000),
    midCents: int(r.midCents, d.midCents, 0, 100_000),
    overCents: int(r.overCents, d.overCents, 0, 100_000),
    midFromCents,
    overAboveCents: Math.max(midFromCents, int(r.overAboveCents, d.overAboveCents, 1, 100_000_000)),
  };
}

export const SUB_DEFAULTS: SubConfig = { purchasesEnabled: true, withdrawalsEnabled: true, purchaseFeePercent: 10, withdrawalFeePercent: 10, minPriceCents: 100, maxPriceCents: 100_000, minWithdrawalCents: 500, holdDays: 0, periodDays: 30, autoPayout: true, requireQualification: false, watermark: true, flatFees: FLAT_FEE_DEFAULTS, payoutProvider: "flutterwave", autoPayoutMaxCents: 50_000, autoPayoutDailyMaxCents: 100_000, newAccountHoldHours: 24 };

export function normalizeSubConfig(raw: unknown): SubConfig {
  const d = SUB_DEFAULTS;
  const r = isRecord(raw) ? raw : {};
  const pct = (v: unknown, dv: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(50, Math.max(0, Math.round(v * 100) / 100)) : dv);
  const minPriceCents = int(r.minPriceCents, d.minPriceCents, 1, 100_000_000);
  return {
    purchasesEnabled: bool(r.purchasesEnabled, d.purchasesEnabled),
    withdrawalsEnabled: bool(r.withdrawalsEnabled, d.withdrawalsEnabled),
    purchaseFeePercent: pct(r.purchaseFeePercent, d.purchaseFeePercent),
    withdrawalFeePercent: pct(r.withdrawalFeePercent, d.withdrawalFeePercent),
    minPriceCents,
    maxPriceCents: Math.max(minPriceCents, int(r.maxPriceCents, d.maxPriceCents, 1, 100_000_000)),
    minWithdrawalCents: int(r.minWithdrawalCents, d.minWithdrawalCents, 1, 100_000_000),
    holdDays: int(r.holdDays, d.holdDays, 0, 90),
    periodDays: int(r.periodDays, d.periodDays, 1, 366),
    autoPayout: bool(r.autoPayout, d.autoPayout),
    requireQualification: bool(r.requireQualification, d.requireQualification),
    watermark: bool(r.watermark, d.watermark),
    flatFees: normalizeFlatFees(r.flatFees),
    payoutProvider: normalizePayoutRoute(r.payoutProvider),
    autoPayoutMaxCents: int(r.autoPayoutMaxCents, d.autoPayoutMaxCents, 0, 100_000_000),
    autoPayoutDailyMaxCents: int(r.autoPayoutDailyMaxCents, d.autoPayoutDailyMaxCents, 0, 100_000_000),
    newAccountHoldHours: int(r.newAccountHoldHours, d.newAccountHoldHours, 0, 720),
  };
}

export const REWARDS_DEFAULTS: RewardsConfig = {
  enabled: true,
  events: {
    ...(Object.fromEntries(REWARD_EVENTS.map((e) => [e, { ...OFF }])) as Record<RewardEventType, RewardRule>),
    // 0255 Rewards v2: the ONLY rewards — sign-up (and the invite that brought it), and an invitee's payments
    account_created: { enabled: true, actorCredits: 5, referrerCredits: 5, referrerRepeatable: false, actorOncePerUser: true },
    wallet_topup: { enabled: true, actorCredits: 0, referrerCredits: 10, referrerRepeatable: true, actorOncePerUser: false },
    subscription_started: { enabled: true, actorCredits: 0, referrerCredits: 10, referrerRepeatable: true, actorOncePerUser: false },
    ai_video_completed: { enabled: false, actorCredits: 0, referrerCredits: 0, referrerRepeatable: false, actorOncePerUser: false, features: ["ai_text_to_video", "ai_image_to_video"], includeComplimentary: false },
    ai_video_shared: { enabled: false, actorCredits: 0, referrerCredits: 0, referrerRepeatable: false, actorOncePerUser: false, minDurationSeconds: 30 },
  },
  qualification: { minAccountAgeDays: 30, minEngagements: 100, extraRequirements: [] },
  attribution: { windowDays: 7 },
  quests: QUESTS_DEFAULTS,
  withdrawals: { enabled: false, creditsPerUsd: 10, minCredits: 100, maxCredits: 10_000, maxRequestsPerDay: 1, maxCreditsPerMonth: 50_000, manualReviewAboveCredits: 0, methods: ["paystack", "bank_transfer"], deposited: { creditsPerUsd: 10, feePercent: 10 } },
  sub: SUB_DEFAULTS,
  followers: { enabled: true, minAccountAgeDays: 7, milestones: [{ followers: 100, credits: 5 }, { followers: 1000, credits: 50 }] },
  affiliate: { enabled: true, rateBp: 1000, minFollowers: 5000 },
  weeklyPrizes: { enabled: false },
  rulesV2Applied: false,
  version: 1,
  updatedAt: null,
};

/** 0255: the follower milestones, cleaned — ascending, distinct, at most 6, each a positive count and reward. */
export function normalizeFollowerMilestones(raw: unknown, d: RewardsConfig["followers"]["milestones"]): RewardsConfig["followers"]["milestones"] {
  if (!Array.isArray(raw)) return d.map((m) => ({ ...m }));
  const seen = new Set<number>();
  return raw
    .map((m) => (isRecord(m) ? { followers: int(m.followers, 0, 0, 100_000_000), credits: int(m.credits, 0, 0, 1_000_000) } : null))
    .filter((m): m is { followers: number; credits: number } => !!m && m.followers > 0 && m.credits > 0 && !seen.has(m.followers) && !!seen.add(m.followers))
    .sort((a, b) => a.followers - b.followers)
    .slice(0, 6);
}

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
    qualification: {
      minAccountAgeDays: int(q.minAccountAgeDays, d.qualification.minAccountAgeDays, 0, 3650),
      minEngagements: int(q.minEngagements, d.qualification.minEngagements, 0, 1_000_000),
      extraRequirements: Array.isArray(q.extraRequirements)
        ? q.extraRequirements
            .filter((x): x is string => typeof x === "string")
            .map((x) => x.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120))
            .filter(Boolean)
            .slice(0, 8)
        : [],
    },
    attribution: { windowDays: int(a.windowDays, d.attribution.windowDays, 1, 90) },
    quests: normalizeQuests(r.quests),
    withdrawals: {
      enabled: bool(w.enabled, d.withdrawals.enabled),
      creditsPerUsd: int(w.creditsPerUsd, d.withdrawals.creditsPerUsd, 1, 1_000_000),
      minCredits,
      maxCredits: Math.max(minCredits, int(w.maxCredits, d.withdrawals.maxCredits, 1, 100_000_000)),
      maxRequestsPerDay: int(w.maxRequestsPerDay, d.withdrawals.maxRequestsPerDay, 1, 100),
      maxCreditsPerMonth: int(w.maxCreditsPerMonth, d.withdrawals.maxCreditsPerMonth, 1, 1_000_000_000),
      manualReviewAboveCredits: int(w.manualReviewAboveCredits, d.withdrawals.manualReviewAboveCredits, 0, 100_000_000),
      methods: Array.isArray(w.methods) ? w.methods.filter((m): m is string => typeof m === "string" && /^[a-z_]{2,30}$/.test(m)).slice(0, 6) : [...d.withdrawals.methods],
      deposited: (() => {
        const dep = isRecord(w.deposited) ? w.deposited : {};
        const fee = typeof dep.feePercent === "number" && Number.isFinite(dep.feePercent) ? dep.feePercent : d.withdrawals.deposited.feePercent;
        return { creditsPerUsd: int(dep.creditsPerUsd, d.withdrawals.deposited.creditsPerUsd, 1, 1_000_000), feePercent: Math.min(50, Math.max(0, Math.round(fee * 100) / 100)) };
      })(),
    },
    sub: normalizeSubConfig(r.sub),
    followers: (() => {
      const f = isRecord(r.followers) ? r.followers : {};
      return { enabled: bool(f.enabled, d.followers.enabled), minAccountAgeDays: int(f.minAccountAgeDays, d.followers.minAccountAgeDays, 0, 365), milestones: normalizeFollowerMilestones(f.milestones, d.followers.milestones) };
    })(),
    affiliate: (() => {
      const af = isRecord(r.affiliate) ? r.affiliate : {};
      return { enabled: bool(af.enabled, d.affiliate.enabled), rateBp: int(af.rateBp, d.affiliate.rateBp, 0, 5000), minFollowers: int(af.minFollowers, d.affiliate.minFollowers, 1, 100_000_000) };
    })(),
    weeklyPrizes: { enabled: bool(isRecord(r.weeklyPrizes) ? r.weeklyPrizes.enabled : undefined, d.weeklyPrizes.enabled) },
    rulesV2Applied: bool(r.rulesV2Applied, d.rulesV2Applied),
    version: int(r.version, d.version, 1, 1_000_000_000),
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : null,
  };
}

/** A save that changes any amount or rule bumps the version stamped on every reward after it. */
export function versionRewardsConfig(previous: RewardsConfig, next: RewardsConfig, now: Date = new Date()): RewardsConfig {
  // Frenz Coin Part 2 (M5): the SUB money settings (fees, flat-fee tiers, payout provider, automatic payout, fraud limits) count too
  const fp = (c: RewardsConfig) => JSON.stringify({ e: c.enabled, ev: c.events, q: c.qualification, a: c.attribution, w: c.withdrawals, qs: c.quests, f: c.followers, af: c.affiliate, wp: c.weeklyPrizes, s: c.sub });
  if (fp(previous) === fp(next)) return { ...next, version: previous.version, updatedAt: previous.updatedAt };
  return { ...next, version: previous.version + 1, updatedAt: now.toISOString() };
}

/** Credits → US cents at the operator's rate (floor — a withdrawal never pays a fraction of a cent it did not earn). */
export function withdrawalUsdCents(credits: number, creditsPerUsd: number): number {
  return Math.floor((Math.max(0, Math.floor(credits)) * 100) / Math.max(1, creditsPerUsd));
}

/**
 * 0202: a withdrawal's payout when part of it came from a deposit. Credits are
 * spent earned-first, so the deposited part is what is left beyond the earned
 * credits. That part is paid at the deposited rate, less the deposited fee (floor).
 */
export function splitWithdrawalUsdCents(credits: number, withdrawable: number, deposited: number, w: RewardsConfig["withdrawals"]): { usdCents: number; depositedPart: number } {
  const c = Math.max(0, Math.floor(credits));
  const earned = Math.max(0, Math.floor(withdrawable) - Math.max(0, Math.floor(deposited)));
  const depositedPart = Math.max(0, c - earned);
  const earnedPart = c - depositedPart;
  const depGross = (depositedPart * 100) / Math.max(1, w.deposited.creditsPerUsd);
  const usdCents = Math.floor((earnedPart * 100) / Math.max(1, w.creditsPerUsd) + depGross * (1 - w.deposited.feePercent / 100));
  return { usdCents: Math.max(0, usdCents), depositedPart };
}

/** What a browser may know: amounts and thresholds, nothing else. */
export function publicRewardsConfig(c: RewardsConfig) {
  return {
    enabled: c.enabled,
    events: Object.fromEntries(REWARD_EVENTS.filter((e) => c.events[e].enabled && (c.events[e].actorCredits > 0 || c.events[e].referrerCredits > 0)).map((e) => [e, { label: REWARD_EVENT_LABELS[e], actorCredits: c.events[e].actorCredits, referrerCredits: c.events[e].referrerCredits, minDurationSeconds: c.events[e].minDurationSeconds ?? null }])),
    qualification: c.qualification,
    withdrawals: c.withdrawals.enabled ? { creditsPerUsd: c.withdrawals.creditsPerUsd, minCredits: c.withdrawals.minCredits, maxCredits: c.withdrawals.maxCredits, methods: c.withdrawals.methods, flatFees: c.sub.flatFees } : null,
  };
}
