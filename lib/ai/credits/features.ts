/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE FEATURE TABLE — one row of rules per paid Frenz AI tool (pure)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-10-07 (credit brief §5): "AI credit prices must NOT be
 * hard-coded … The Admin Dashboard must control the credit cost for each AI
 * feature … enabled/disabled · credit cost · minimum credits · maximum input
 * duration · plan availability · free / Pro / Business allowance ·
 * pay-as-you-go availability." Tiers decided the same day: Free / AI Pro /
 * AI Max (the AI plan in `ai_subscriptions`).
 *
 * Stored in `frenzAiPlans.features`, beside the one credit rate. What each
 * field MEANS, so nothing here becomes a second price list:
 *
 *   enabled         a master switch over the tool's own switch (both must be on)
 *   payAsYouGo      wallet credits may pay for it; off = a plan's allowance only
 *   tiers           who may use it at all (Free / AI Pro / AI Max)
 *   minimumCredits  the least one generation costs in credits (0 = the global minimum)
 *   maxInputSeconds a ceiling over the tool's own (video length, lip-sync clip); null = the tool's
 *   monthlyIncluded generations per calendar month that cost nothing, per tier (0 = none)
 *
 * The credit COST itself is the tool's own priced total converted by the one
 * engine (lib/ai/credits/engine.ts) — tilted per feature by
 * `credits.featureMultiplier`, which the same admin table edits. One formula.
 *
 * Text to Audio's allowance is CHARACTERS (brief §7) and Voice Cloning's is free
 * voices a month — both live in the tool's own config; `monthlyIncluded` is
 * not offered for them, so a member never has two allowances for one tool.
 */

export type AiTier = "free" | "ai_pro" | "ai_max";
export const AI_TIERS: readonly AiTier[] = ["free", "ai_pro", "ai_max"];

/** The paid tools, by their ai_jobs feature id. */
export const AI_CREDIT_FEATURES = ["ai_text_to_video", "ai_image_to_video", "ai_lip_sync", "ai_voice_clone", "ai_text_to_audio"] as const;
export type AiCreditFeatureId = (typeof AI_CREDIT_FEATURES)[number];

export const AI_FEATURE_LABELS: Record<AiCreditFeatureId, string> = {
  ai_text_to_video: "Text to Video",
  ai_image_to_video: "Image to Video",
  ai_lip_sync: "Lip Sync",
  ai_voice_clone: "Voice Cloning",
  ai_text_to_audio: "Text to Audio",
};

/** Features whose input has a length a ceiling can apply to. */
export const AI_FEATURES_WITH_DURATION: readonly AiCreditFeatureId[] = ["ai_text_to_video", "ai_image_to_video", "ai_lip_sync"];
/**
 * Features with an allowance of their OWN — no `monthlyIncluded` here, so there are never two:
 * Text to Audio counts characters (its config), Voice Cloning free voices a month (its config).
 */
export const AI_FEATURES_BY_CHARACTER: readonly AiCreditFeatureId[] = ["ai_text_to_audio", "ai_voice_clone"];

export interface AiFeaturePolicy {
  enabled: boolean;
  payAsYouGo: boolean;
  tiers: Record<AiTier, boolean>;
  minimumCredits: number;
  maxInputSeconds: number | null;
  monthlyIncluded: Record<AiTier, number>;
}

export const AI_FEATURE_BOUNDS = {
  minimumCredits: { min: 0, max: 100_000 },
  maxInputSeconds: { min: 1, max: 3600 },
  monthlyIncluded: { min: 0, max: 10_000 },
} as const;

/** Everything on, nothing included, no extra ceiling — exactly how the tools behaved before this table existed. */
export const AI_FEATURE_POLICY_DEFAULT: AiFeaturePolicy = {
  enabled: true,
  payAsYouGo: true,
  tiers: { free: true, ai_pro: true, ai_max: true },
  minimumCredits: 0,
  maxInputSeconds: null,
  monthlyIncluded: { free: 0, ai_pro: 0, ai_max: 0 },
};

export type AiFeaturePolicies = Record<AiCreditFeatureId, AiFeaturePolicy>;

export const AI_FEATURE_POLICIES_DEFAULT: AiFeaturePolicies = Object.fromEntries(AI_CREDIT_FEATURES.map((id) => [id, clonePolicy(AI_FEATURE_POLICY_DEFAULT)])) as AiFeaturePolicies;

function clonePolicy(p: AiFeaturePolicy): AiFeaturePolicy {
  return { ...p, tiers: { ...p.tiers }, monthlyIncluded: { ...p.monthlyIncluded } };
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function int(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function normalizePolicy(raw: unknown, id: AiCreditFeatureId): AiFeaturePolicy {
  const d = AI_FEATURE_POLICY_DEFAULT;
  const r = isRecord(raw) ? raw : {};
  const t = isRecord(r.tiers) ? r.tiers : {};
  const m = isRecord(r.monthlyIncluded) ? r.monthlyIncluded : {};
  const byCharacter = AI_FEATURES_BY_CHARACTER.includes(id);
  const hasDuration = AI_FEATURES_WITH_DURATION.includes(id);
  const maxRaw = r.maxInputSeconds;
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : d.enabled,
    payAsYouGo: typeof r.payAsYouGo === "boolean" ? r.payAsYouGo : d.payAsYouGo,
    tiers: Object.fromEntries(AI_TIERS.map((k) => [k, typeof t[k] === "boolean" ? t[k] : d.tiers[k]])) as Record<AiTier, boolean>,
    minimumCredits: int(r.minimumCredits, d.minimumCredits, AI_FEATURE_BOUNDS.minimumCredits.min, AI_FEATURE_BOUNDS.minimumCredits.max),
    maxInputSeconds: !hasDuration || maxRaw === null || maxRaw === undefined || maxRaw === "" ? null : int(maxRaw, 0, AI_FEATURE_BOUNDS.maxInputSeconds.min, AI_FEATURE_BOUNDS.maxInputSeconds.max),
    monthlyIncluded: Object.fromEntries(AI_TIERS.map((k) => [k, byCharacter ? 0 : int(m[k], d.monthlyIncluded[k], AI_FEATURE_BOUNDS.monthlyIncluded.min, AI_FEATURE_BOUNDS.monthlyIncluded.max)])) as Record<AiTier, number>,
  };
}

export function normalizeAiFeaturePolicies(raw: unknown): AiFeaturePolicies {
  const r = isRecord(raw) ? raw : {};
  return Object.fromEntries(AI_CREDIT_FEATURES.map((id) => [id, normalizePolicy(r[id], id)])) as AiFeaturePolicies;
}

export function isAiCreditFeature(id: unknown): id is AiCreditFeatureId {
  return typeof id === "string" && (AI_CREDIT_FEATURES as readonly string[]).includes(id);
}

/** The policy for a feature id; an id outside the table gets the defaults (it behaves as before). */
export function featurePolicy(policies: AiFeaturePolicies | undefined, id: string): AiFeaturePolicy {
  return (policies && isAiCreditFeature(id) ? policies[id] : null) ?? AI_FEATURE_POLICY_DEFAULT;
}

/** The member's tier: their ACTIVE AI plan, else Free. */
export function tierOf(plan: "ai_pro" | "ai_max" | null | undefined): AiTier {
  return plan === "ai_max" ? "ai_max" : plan === "ai_pro" ? "ai_pro" : "free";
}

export type FeatureAccess =
  | { ok: true; tier: AiTier; includedPerMonth: number; payAsYouGo: boolean }
  /** `upgrade` names the lowest tier that WOULD allow it, so the UI can say "Get AI Pro" rather than "unavailable". */
  | { ok: false; tier: AiTier; reason: "disabled" | "tier"; upgrade: AiTier | null };

/** May this tier use this feature at all? (Funding is decided after.) */
export function featureAccess(policy: AiFeaturePolicy, tier: AiTier): FeatureAccess {
  if (!policy.enabled) return { ok: false, tier, reason: "disabled", upgrade: null };
  if (!policy.tiers[tier]) {
    const order: AiTier[] = ["free", "ai_pro", "ai_max"];
    const upgrade = order.slice(order.indexOf(tier) + 1).find((t) => policy.tiers[t]) ?? null;
    return { ok: false, tier, reason: "tier", upgrade };
  }
  return { ok: true, tier, includedPerMonth: policy.monthlyIncluded[tier], payAsYouGo: policy.payAsYouGo };
}

/** Over the operator's extra ceiling? null = within (or no ceiling for this feature). */
export function overMaxInput(policy: AiFeaturePolicy, seconds: number): number | null {
  if (policy.maxInputSeconds === null) return null;
  return seconds > policy.maxInputSeconds + 1e-6 ? policy.maxInputSeconds : null;
}

/** "2026-10" in the operator's zone — the month an included use counts against (the same key Text to Audio uses). */
export function includedPeriodKey(now: Date, timezone: string): string {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit" }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "2-digit" }).formatToParts(now);
  }
  const y = parts.find((p) => p.type === "year")?.value ?? String(now.getUTCFullYear());
  const m = parts.find((p) => p.type === "month")?.value ?? String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** What a browser may know about a feature's rules — for the cost line, the badges and the "Get AI Pro" prompt. */
export function publicFeatureAccess(policy: AiFeaturePolicy, tier: AiTier, includedUsed: number) {
  const access = featureAccess(policy, tier);
  const included = access.ok ? access.includedPerMonth : 0;
  // would a higher tier include more of this, or open it? — "upgrading changes the allowance" (brief §13)
  const better = AI_TIERS.slice(AI_TIERS.indexOf(tier) + 1).find((t) => policy.enabled && policy.tiers[t] && (!policy.tiers[tier] || policy.monthlyIncluded[t] > policy.monthlyIncluded[tier])) ?? null;
  return {
    tier,
    available: access.ok,
    reason: access.ok ? null : access.reason,
    payAsYouGo: policy.payAsYouGo,
    includedPerMonth: included,
    includedRemaining: Math.max(0, included - includedUsed),
    upgradeTier: better,
    upgradeIncludedPerMonth: better ? policy.monthlyIncluded[better] : null,
    maxInputSeconds: policy.maxInputSeconds,
  };
}
export type PublicFeatureAccess = ReturnType<typeof publicFeatureAccess>;
