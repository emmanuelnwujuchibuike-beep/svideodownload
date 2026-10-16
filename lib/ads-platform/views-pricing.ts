import type { AdCatalog, CatalogDuration } from "./offer";

/**
 * Views-based campaigns (0240) — the rules the browser and the server read
 * BEFORE the database decides. `ad_views_price_for` is the authority: the price
 * shown here is an estimate that follows it rule for rule, and the server
 * refuses early with the same reason codes. Nothing here can make a price.
 *
 *   price = target views × rate (US cents per 1,000) ÷ 1,000, rounded DOWN to
 *   the cent — integers only (target ≤ 1e8 × rate ≤ 1e7 stays far inside 2^53).
 */

export type PricingModel = "fixed_period" | "views_based";
export const PRICING_MODELS: readonly PricingModel[] = ["fixed_period", "views_based"];

export interface ViewsTerms {
  ratePer1000Minor: number;
  minTarget: number;
  maxTarget: number;
  step: number;
  autoExtend: boolean;
  extensionDays: number;
  maxExtensions: number;
  /** 0242: from `minViews` up the rate is `ratePer1000Minor` (absent before 0242 = none) */
  tiers: VolumeTier[];
  /** 0242: the smallest checkout total, in cents (0 = none) */
  minCheckoutMinor: number;
}

export interface VolumeTier {
  minViews: number;
  ratePer1000Minor: number;
}

/** Tiers from the catalog or an admin request: whole positive numbers only, sorted by threshold. */
export function parseTiers(raw: unknown): VolumeTier[] | null {
  if (!Array.isArray(raw)) return null;
  const out: VolumeTier[] = [];
  for (const t of raw) {
    const r = t as { min_views?: unknown; rate_per_1000_minor?: unknown; minViews?: unknown; ratePer1000Minor?: unknown };
    const minViews = Number(r.min_views ?? r.minViews);
    const rate = Number(r.rate_per_1000_minor ?? r.ratePer1000Minor);
    if (!Number.isSafeInteger(minViews) || minViews < 1 || !Number.isSafeInteger(rate) || rate < 1) return null;
    out.push({ minViews, ratePer1000Minor: rate });
  }
  return out.sort((a, b) => a.minViews - b.minViews);
}

/** The admin's current views terms, or null when views are not sold (or 0240 has not run). */
export function viewsTermsOf(cat: AdCatalog): ViewsTerms | null {
  const s = cat.settings;
  if (s.views_enabled !== true) return null;
  const t = {
    ratePer1000Minor: Number(s.views_rate_per_1000_minor),
    minTarget: Number(s.views_min_target),
    maxTarget: Number(s.views_max_target),
    step: Number(s.views_target_step),
    autoExtend: s.views_auto_extend === true,
    extensionDays: Number(s.views_extension_days),
    maxExtensions: Number(s.views_max_extensions),
    tiers: parseTiers(s.views_volume_tiers ?? []) ?? [],
    minCheckoutMinor: Number(s.views_min_checkout_minor ?? 0) || 0,
  };
  return [t.ratePer1000Minor, t.minTarget, t.maxTarget, t.step].every((n) => Number.isSafeInteger(n) && n > 0) ? t : null;
}

/**
 * The rate for a placement and target — ad_views_rate's order: the placement's
 * own rate, else the cheapest tier the target reaches, else the default. Null
 * when the placement does not sell views.
 */
export function viewsRateFor(cat: AdCatalog, terms: ViewsTerms, placementCode: string, target: number = terms.minTarget): number | null {
  const p = cat.placements.find((x) => x.code === placementCode);
  if (!p || p.views_enabled === false) return null;
  if (p.views_rate_per_1000_minor != null) return p.views_rate_per_1000_minor;
  const reached = terms.tiers.filter((t) => t.minViews <= target).map((t) => t.ratePer1000Minor);
  return reached.length ? Math.min(...reached) : terms.ratePer1000Minor;
}

/** The periods a views campaign may choose: enabled, and switched on for views. */
export function offeredViewsDurations(cat: AdCatalog): CatalogDuration[] {
  return cat.durations.filter((d) => d.views_enabled !== false);
}

/**
 * A target from a request: a whole, positive number of views — never a
 * fraction, an exponent, a sign or a string with anything but digits.
 */
export function parseTargetViews(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isSafeInteger(raw) && raw > 0 ? raw : null;
  if (typeof raw === "string" && /^[0-9]{1,9}$/.test(raw.trim())) {
    const n = Number(raw.trim());
    return n > 0 ? n : null;
  }
  return null;
}

/** Why a target can't be bought — the same codes and order as ad_views_price_for. */
export function targetProblem(terms: ViewsTerms, target: number): "target_too_small" | "target_too_large" | "target_step" | null {
  if (target < terms.minTarget) return "target_too_small";
  if (target > terms.maxTarget) return "target_too_large";
  if (target % terms.step !== 0) return "target_step";
  return null;
}

export function viewsPriceMinor(target: number, ratePer1000Minor: number): number {
  return Math.floor((target * ratePer1000Minor) / 1000);
}

/* ───────────────────── the views slider (Part 2) ─────────────────────
   A logarithmic scale: 1,000 → 1,000,000 is three decades, so a linear track
   would put every small campaign in its bottom 1 %. Every value the slider
   gives is a whole multiple of the step inside the bounds; the number field
   reaches any exact target. */

/** The smallest and largest targets that are whole steps inside the bounds. */
export function targetRange(t: ViewsTerms): { lo: number; hi: number } {
  const lo = Math.ceil(t.minTarget / t.step) * t.step;
  const hi = Math.max(lo, Math.floor(t.maxTarget / t.step) * t.step);
  return { lo, hi };
}

/** Any number → the nearest buyable target (whole step, inside the bounds). */
export function snapTarget(t: ViewsTerms, v: number): number {
  const { lo, hi } = targetRange(t);
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(v / t.step) * t.step));
}

/** A round number near v (2 significant figures), then snapped — what a drag lands on. */
function roundish(t: ViewsTerms, v: number): number {
  const mag = 10 ** Math.max(0, Math.floor(Math.log10(Math.max(1, v))) - 1);
  return snapTarget(t, Math.round(v / mag) * mag);
}

/** Track position (0 = bottom, 1 = top) → target. */
export function sliderToTarget(t: ViewsTerms, frac: number): number {
  const { lo, hi } = targetRange(t);
  const f = Math.min(1, Math.max(0, frac));
  if (f <= 0) return lo;
  if (f >= 1) return hi;
  return roundish(t, lo * (hi / lo) ** f);
}

/** Target → track position. */
export function targetToSlider(t: ViewsTerms, target: number): number {
  const { lo, hi } = targetRange(t);
  if (hi <= lo) return 0;
  return Math.min(1, Math.max(0, Math.log(snapTarget(t, target) / lo) / Math.log(hi / lo)));
}

/** One keyboard step along the track (a PageUp is ten), always moving at least one buyable step. */
export function nudgeTarget(t: ViewsTerms, target: number, notches: number): number {
  const cur = snapTarget(t, target);
  const next = sliderToTarget(t, targetToSlider(t, cur) + notches / 100);
  if (next !== cur) return next;
  return snapTarget(t, cur + Math.sign(notches) * t.step);
}

/** Round shortcuts inside the bounds (1K, 5K, 10K, 25K …) — no dragging for the common sizes. */
export function presetTargets(t: ViewsTerms): number[] {
  const { lo, hi } = targetRange(t);
  const out = new Set<number>([lo]);
  for (const v of [1_000, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 5_000_000, 10_000_000]) {
    if (v > lo && v <= hi) out.add(snapTarget(t, v));
  }
  out.add(hi);
  return [...out].sort((a, b) => a - b).slice(0, 8);
}
