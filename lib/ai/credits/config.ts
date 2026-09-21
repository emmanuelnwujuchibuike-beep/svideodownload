/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  AI PRO / AI MAX — the plans, the included credits, the credit rules
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-21: "a dedicated AI subscription system separate from the
 * normal FrenzSave Pro/Business subscription … every value configurable from
 * the admin dashboard … 1 credit DOES NOT equal 1 video … one centralized
 * credit calculation engine … configurable without code changes."
 *
 * This module is PURE (no imports, like lib/ai/character-replace/config.ts):
 * the type, the defaults, the bounds and the normaliser. It is stored under
 * ONE key of the landing settings row (`frenzAiPlans`), merged on the way in
 * and clamped on the way out, exactly as the Character Replace config is.
 *
 * ── Why the credit rules are a CONVERSION, not a second price list ─────────
 *
 * Character Replace already has one pricing engine that knows every option
 * that changes the cost — the scope, the tier, the trimmed length, the voice,
 * the lip sync, the base price, the minimum (lib/ai/character-replace/pricing.ts,
 * the admin Pricing tab). A parallel "credits per second per quality per
 * mode" table would be a second formula that drifts from the first. So the
 * engine (lib/ai/credits/engine.ts) converts THE PRICED TOTAL into credits:
 * `centsPerCredit` sets what a credit is worth, `minimumCredits` the floor,
 * and the multipliers let the operator tilt one scope, one tier or one
 * feature without touching money prices. Every future tool that produces a
 * priced quote gets credits the same way — no per‑tool credit code.
 *
 * Defaults, derived from today's prices (USD wallet, 720p Full Character at
 * 25¢/s): 1 credit = 10¢, so a 5‑second 720p Full Character is 13 credits, a
 * 5‑second Face Only 8. AI Pro (15/day, 70/week) is about one such video a
 * day; AI Max (50/day, 250/week) about four. A long, high‑quality generation
 * can take a whole day's allowance — that is the brief's intent.
 */

export type AiPlanId = "ai_pro" | "ai_max";
export const AI_PLAN_IDS: readonly AiPlanId[] = ["ai_pro", "ai_max"];
export type AiBillingInterval = "monthly" | "yearly";
export type AiWalletFallback = "allow" | "ask" | "off";

export interface AiPlanConfig {
  enabled: boolean;
  label: string;
  /** In the AI currency's minor units (the wallet's currency — USD cents since 0159). Display; Paystack charges the plan's own amount. */
  priceCents: number;
  interval: AiBillingInterval;
  dailyCredits: number;
  weeklyCredits: number;
  /** PLN_… from the Paystack dashboard. Empty = the plan cannot be bought yet (shown as "coming soon"). */
  paystackPlanCode: string;
  blurb: string;
}

export interface AiPlansConfig {
  /** The whole offer. Off = no plan can be bought and no credits are spent; the wallet and the complimentary creations work as before. */
  enabled: boolean;
  plans: Record<AiPlanId, AiPlanConfig>;
  /**
   * The ONE‑TIME complimentary creations (Part 11's `ai_free_entitlements`),
   * now per SITE plan: how many a Free, a Pro and a Business member is
   * granted on first sight. Lifetime, never daily. `enabled` off = nobody is
   * granted; the Character Replace `freeAccess.enabled` switch still applies.
   */
  freeCreations: { enabled: boolean; free: number | null; pro: number | null; business: number | null };
  credits: {
    /** What one credit is worth, in the AI currency's minor units. */
    centsPerCredit: number;
    minimumCredits: number;
    rounding: "ceil" | "nearest";
    /** Per replacement scope; 1 = no tilt. Unknown keys are ignored. */
    modeMultiplier: Record<string, number>;
    /** Per quality tier id ("480p", "720p", "1080p", "standard", "high", "ultra"); 1 = no tilt. */
    qualityMultiplier: Record<string, number>;
    /** Per feature id; 1 = no tilt. */
    featureMultiplier: Record<string, number>;
  };
  reset: {
    /** IANA zone the day and the week roll over in. Server‑side; a device clock changes nothing. */
    timezone: string;
    /** 0 = Sunday … 6 = Saturday. */
    weekStartsOn: number;
  };
  /**
   * When a member on an AI plan cannot cover a generation with what is left
   * today/this week: `allow` = the wallet pays as it always did; `ask` = the
   * member is shown the shortfall and chooses (upgrade, or pay from the
   * wallet); `off` = upgrade only. A member with NO AI plan is unaffected —
   * the wallet is their only paid route, as before.
   */
  walletFallback: AiWalletFallback;
  /** Increments on every saved change to a value that affects entitlement or cost; stamped on each ledger row. */
  version: number;
  updatedAt: string | null;
}

export const AI_PLANS_BOUNDS = {
  priceCents: { min: 0, max: 100_000_000 },
  dailyCredits: { min: 0, max: 100_000 },
  weeklyCredits: { min: 0, max: 1_000_000 },
  freeCreations: { min: 0, max: 100 },
  centsPerCredit: { min: 1, max: 1_000_000 },
  minimumCredits: { min: 0, max: 10_000 },
  multiplier: { min: 0.1, max: 20 },
} as const;

export const AI_PLANS_DEFAULTS: AiPlansConfig = {
  enabled: true,
  plans: {
    ai_pro: { enabled: true, label: "AI Pro", priceCents: 1000, interval: "monthly", dailyCredits: 15, weeklyCredits: 70, paystackPlanCode: "", blurb: "Character Replace and every Pro and Business AI feature, with a daily allowance of credits." },
    ai_max: { enabled: true, label: "AI Max", priceCents: 2000, interval: "monthly", dailyCredits: 50, weeklyCredits: 250, paystackPlanCode: "", blurb: "Everything in AI Pro with the largest allowance — the maximum AI usage tier." },
  },
  // null = the count on the Character Replace tab (`freeAccess.creationsPerAccount`) — one control until the operator sets a plan apart
  freeCreations: { enabled: true, free: null, pro: null, business: null },
  credits: {
    centsPerCredit: 10,
    minimumCredits: 1,
    rounding: "ceil",
    modeMultiplier: { face_only: 1, skin_face: 1, upper_body: 1, full_character: 1 },
    qualityMultiplier: {},
    featureMultiplier: { ai_character_replace: 1 },
  },
  reset: { timezone: "Africa/Lagos", weekStartsOn: 1 },
  walletFallback: "ask",
  version: 1,
  updatedAt: null,
};

/* ───────────────────────────── normaliser ────────────────────────────────── */

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function int(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}
function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
/** A count that may be unset (null): absent, null, "" → null; anything numeric is clamped. */
function optionalInt(v: unknown, min: number, max: number): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.floor(n)));
}
function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}
function text(v: unknown, fallback: string, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) || fallback : fallback;
}
function multipliers(v: unknown, fallback: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = { ...fallback };
  if (!isRecord(v)) return out;
  for (const [k, raw] of Object.entries(v)) {
    if (!/^[a-z0-9_]{1,40}$/i.test(k)) continue;
    out[k] = num(raw, fallback[k] ?? 1, AI_PLANS_BOUNDS.multiplier.min, AI_PLANS_BOUNDS.multiplier.max);
  }
  return out;
}
/** A Paystack plan code is `PLN_` + base62; anything else is kept only if it is a plausible token (a test code). */
function planCode(v: unknown): string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{0,100}$/.test(v.trim()) ? v.trim() : "";
}
/** An IANA zone the runtime knows; otherwise the default (a typo must not stop every day from rolling over). */
export function validTimezone(v: unknown, fallback: string): string {
  if (typeof v !== "string" || !v.trim()) return fallback;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: v.trim() });
    return v.trim();
  } catch {
    return fallback;
  }
}

function normalizePlan(raw: unknown, d: AiPlanConfig): AiPlanConfig {
  const r = isRecord(raw) ? raw : {};
  const daily = int(r.dailyCredits, d.dailyCredits, AI_PLANS_BOUNDS.dailyCredits.min, AI_PLANS_BOUNDS.dailyCredits.max);
  return {
    enabled: bool(r.enabled, d.enabled),
    label: text(r.label, d.label, 24),
    priceCents: int(r.priceCents, d.priceCents, AI_PLANS_BOUNDS.priceCents.min, AI_PLANS_BOUNDS.priceCents.max),
    interval: r.interval === "yearly" ? "yearly" : "monthly",
    dailyCredits: daily,
    // a week can never allow less than a day
    weeklyCredits: Math.max(daily, int(r.weeklyCredits, d.weeklyCredits, AI_PLANS_BOUNDS.weeklyCredits.min, AI_PLANS_BOUNDS.weeklyCredits.max)),
    paystackPlanCode: planCode(r.paystackPlanCode),
    blurb: text(r.blurb, d.blurb, 160),
  };
}

export function normalizeAiPlansConfig(raw: unknown): AiPlansConfig {
  const d = AI_PLANS_DEFAULTS;
  if (!isRecord(raw)) return d;
  const plans = isRecord(raw.plans) ? raw.plans : {};
  const free = isRecord(raw.freeCreations) ? raw.freeCreations : {};
  const credits = isRecord(raw.credits) ? raw.credits : {};
  const reset = isRecord(raw.reset) ? raw.reset : {};
  return {
    enabled: bool(raw.enabled, d.enabled),
    plans: { ai_pro: normalizePlan(plans.ai_pro, d.plans.ai_pro), ai_max: normalizePlan(plans.ai_max, d.plans.ai_max) },
    freeCreations: {
      enabled: bool(free.enabled, d.freeCreations.enabled),
      free: optionalInt(free.free, AI_PLANS_BOUNDS.freeCreations.min, AI_PLANS_BOUNDS.freeCreations.max),
      pro: optionalInt(free.pro, AI_PLANS_BOUNDS.freeCreations.min, AI_PLANS_BOUNDS.freeCreations.max),
      business: optionalInt(free.business, AI_PLANS_BOUNDS.freeCreations.min, AI_PLANS_BOUNDS.freeCreations.max),
    },
    credits: {
      centsPerCredit: int(credits.centsPerCredit, d.credits.centsPerCredit, AI_PLANS_BOUNDS.centsPerCredit.min, AI_PLANS_BOUNDS.centsPerCredit.max),
      minimumCredits: int(credits.minimumCredits, d.credits.minimumCredits, AI_PLANS_BOUNDS.minimumCredits.min, AI_PLANS_BOUNDS.minimumCredits.max),
      rounding: credits.rounding === "nearest" ? "nearest" : "ceil",
      modeMultiplier: multipliers(credits.modeMultiplier, d.credits.modeMultiplier),
      qualityMultiplier: multipliers(credits.qualityMultiplier, d.credits.qualityMultiplier),
      featureMultiplier: multipliers(credits.featureMultiplier, d.credits.featureMultiplier),
    },
    reset: { timezone: validTimezone(reset.timezone, d.reset.timezone), weekStartsOn: int(reset.weekStartsOn, d.reset.weekStartsOn, 0, 6) },
    walletFallback: raw.walletFallback === "allow" || raw.walletFallback === "off" ? raw.walletFallback : "ask",
    version: int(raw.version, d.version, 1, 1_000_000_000),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
  };
}

/**
 * The fields whose change alters what a member is entitled to or what a
 * generation costs — a save that changes any of them bumps `version`, and the
 * version is stamped on every ledger row so history is never re-read under
 * today's numbers (brief § "ADMIN CONFIGURATION SAFETY").
 */
export function aiPlansFingerprint(c: AiPlansConfig): string {
  return JSON.stringify({
    enabled: c.enabled,
    plans: AI_PLAN_IDS.map((id) => [c.plans[id].enabled, c.plans[id].dailyCredits, c.plans[id].weeklyCredits, c.plans[id].priceCents, c.plans[id].interval]),
    free: c.freeCreations,
    credits: c.credits,
    reset: c.reset,
    walletFallback: c.walletFallback,
  });
}

export function versionAiPlans(previous: AiPlansConfig, next: AiPlansConfig, now: Date = new Date()): AiPlansConfig {
  if (aiPlansFingerprint(previous) === aiPlansFingerprint(next)) return { ...next, version: previous.version, updatedAt: previous.updatedAt };
  return { ...next, version: previous.version + 1, updatedAt: now.toISOString() };
}

/* ───────────────────────────── the public view ───────────────────────────── */

/** What a browser may know: prices and allowances for the plan cards, never a plan code or a multiplier table. */
export interface AiPlansPublic {
  enabled: boolean;
  currency: string;
  symbol: string;
  plans: { id: AiPlanId; label: string; priceCents: number; interval: AiBillingInterval; dailyCredits: number; weeklyCredits: number; blurb: string; purchasable: boolean }[];
  walletFallback: AiWalletFallback;
  centsPerCredit: number;
  reset: { timezone: string; weekStartsOn: number };
}

export function publicAiPlansConfig(c: AiPlansConfig, currency: { code: string; symbol: string }): AiPlansPublic {
  return {
    enabled: c.enabled,
    currency: currency.code,
    symbol: currency.symbol,
    plans: AI_PLAN_IDS.filter((id) => c.plans[id].enabled).map((id) => {
      const p = c.plans[id];
      return { id, label: p.label, priceCents: p.priceCents, interval: p.interval, dailyCredits: p.dailyCredits, weeklyCredits: p.weeklyCredits, blurb: p.blurb, purchasable: c.enabled && p.paystackPlanCode.length > 0 };
    }),
    walletFallback: c.walletFallback,
    centsPerCredit: c.credits.centsPerCredit,
    reset: c.reset,
  };
}

/** The complimentary creations a member on this SITE plan is granted (Part 11's count, per plan). */
export function freeCreationsFor(c: AiPlansConfig, sitePlan: "free" | "pro" | "business" | string, fallback: number): number {
  if (!c.freeCreations.enabled) return 0;
  const own = sitePlan === "pro" ? c.freeCreations.pro : sitePlan === "business" ? c.freeCreations.business : sitePlan === "free" ? c.freeCreations.free : null;
  return own ?? fallback;
}

/** AI Max includes everything AI Pro does: the higher plan wins any comparison. */
export function aiPlanRank(plan: AiPlanId | null | undefined): number {
  return plan === "ai_max" ? 2 : plan === "ai_pro" ? 1 : 0;
}
