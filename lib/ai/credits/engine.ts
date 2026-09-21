import type { AiPlansConfig } from "@/lib/ai/credits/config";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE CREDIT ENGINE — one calculator for every AI tool
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-21: "Create ONE centralized AI credit calculation engine.
 * Do NOT implement separate credit formulas inside individual AI pages …
 * The breakdown should make it possible to explain to the user why a
 * generation costs a particular number of credits … Build this as a
 * reusable AI entitlement + credit system … Each feature provides its
 * processing parameters. The centralized credit engine determines the cost."
 *
 * A feature hands in what it already knows — its PRICED total (the output of
 * its own pricing engine, which accounts for duration, quality, mode, trim,
 * voice, lip sync, base price and minimum) and the options that were priced.
 * The engine converts that into credits under the operator's rules:
 *
 *   credits = round( priceCents / centsPerCredit
 *                    × featureMultiplier × modeMultiplier × qualityMultiplier )
 *   credits = max(credits, minimumCredits)
 *
 * Every step is a line in the breakdown, in the member's terms. Pure: the
 * quote route, /start and the tests call the same function; the client only
 * displays what the server answered (and may estimate with the same public
 * rule for instant feedback — the server's figure is the one that reserves).
 */

export interface CreditRequest {
  feature: string;
  /** The priced total in the AI currency's minor units. */
  priceCents: number;
  /** The options that were priced — for the multipliers and the breakdown. */
  mode?: string | null;
  quality?: string | null;
  durationMs?: number | null;
  /** The priced lines, when the feature has them — carried into the breakdown so "why" is answerable. */
  lines?: readonly { label: string; cents: number }[];
}

export interface CreditLine {
  key: string;
  label: string;
  /** A factor line ("× 1.2") or a credit line; one of the two is set. */
  credits?: number;
  factor?: number;
  detail?: string | null;
}

export interface CreditEstimate {
  creditsRequired: number;
  priceCents: number;
  centsPerCredit: number;
  feature: string;
  mode: string | null;
  quality: string | null;
  durationMs: number | null;
  breakdown: CreditLine[];
  /** The configuration version the estimate was made under. */
  configVersion: number;
}

export function calculateCredits(req: CreditRequest, config: AiPlansConfig): CreditEstimate {
  const rules = config.credits;
  const cents = Math.max(0, Math.round(req.priceCents));
  const raw = cents / Math.max(1, rules.centsPerCredit);
  const featureFactor = rules.featureMultiplier[req.feature] ?? 1;
  const modeFactor = req.mode ? (rules.modeMultiplier[req.mode] ?? 1) : 1;
  const qualityFactor = req.quality ? (rules.qualityMultiplier[req.quality] ?? 1) : 1;
  const scaled = raw * featureFactor * modeFactor * qualityFactor;
  const rounded = rules.rounding === "nearest" ? Math.round(scaled) : Math.ceil(scaled - 1e-9);
  const credits = cents === 0 ? 0 : Math.max(rules.minimumCredits, rounded);

  const breakdown: CreditLine[] = [];
  if (req.lines?.length) {
    for (const [i, l] of req.lines.entries()) breakdown.push({ key: `price-${i}`, label: l.label, credits: Number((l.cents / Math.max(1, rules.centsPerCredit)).toFixed(2)), detail: null });
  } else {
    breakdown.push({ key: "price", label: describe(req), credits: Number(raw.toFixed(2)), detail: null });
  }
  if (featureFactor !== 1) breakdown.push({ key: "feature", label: "Tool adjustment", factor: featureFactor });
  if (modeFactor !== 1) breakdown.push({ key: "mode", label: `${labelMode(req.mode)} adjustment`, factor: modeFactor });
  if (qualityFactor !== 1) breakdown.push({ key: "quality", label: `${req.quality} adjustment`, factor: qualityFactor });
  if (cents > 0 && rounded < rules.minimumCredits) breakdown.push({ key: "minimum", label: "Minimum per generation", credits: rules.minimumCredits });

  return { creditsRequired: credits, priceCents: cents, centsPerCredit: rules.centsPerCredit, feature: req.feature, mode: req.mode ?? null, quality: req.quality ?? null, durationMs: req.durationMs ?? null, breakdown, configVersion: config.version };
}

function describe(req: CreditRequest): string {
  const parts: string[] = [];
  if (req.mode) parts.push(labelMode(req.mode));
  if (req.quality) parts.push(req.quality);
  if (req.durationMs) parts.push(`${(req.durationMs / 1000).toFixed(req.durationMs % 1000 ? 1 : 0)}-second output`);
  return parts.length ? parts.join(" · ") : "Generation";
}

function labelMode(mode: string | null | undefined): string {
  switch (mode) {
    case "face_only":
      return "Face Only";
    case "skin_face":
      return "Face + Head";
    case "upper_body":
      return "Upper Body";
    case "full_character":
      return "Full Character";
    default:
      return mode ? mode.replace(/_/g, " ") : "Generation";
  }
}

/**
 * What is left after a generation, on both clocks — the member must satisfy
 * BOTH (brief: "Do not treat daily and weekly limits as two separate wallets
 * that can be combined").
 */
export function remainingAfter(input: { required: number; dailyLimit: number; weeklyLimit: number; usedToday: number; usedThisWeek: number }): {
  affordable: boolean;
  reason: "daily" | "weekly" | null;
  remainingToday: number;
  remainingThisWeek: number;
  afterToday: number;
  afterThisWeek: number;
} {
  const remainingToday = Math.max(0, input.dailyLimit - input.usedToday);
  const remainingThisWeek = Math.max(0, input.weeklyLimit - input.usedThisWeek);
  const daily = input.required <= remainingToday;
  const weekly = input.required <= remainingThisWeek;
  return {
    affordable: daily && weekly,
    reason: !daily ? "daily" : !weekly ? "weekly" : null,
    remainingToday,
    remainingThisWeek,
    afterToday: Math.max(0, remainingToday - input.required),
    afterThisWeek: Math.max(0, remainingThisWeek - input.required),
  };
}
