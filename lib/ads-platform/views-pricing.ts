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
  };
  return [t.ratePer1000Minor, t.minTarget, t.maxTarget, t.step].every((n) => Number.isSafeInteger(n) && n > 0) ? t : null;
}

/** A placement's own rate, else the default; null when it does not sell views. */
export function viewsRateFor(cat: AdCatalog, terms: ViewsTerms, placementCode: string): number | null {
  const p = cat.placements.find((x) => x.code === placementCode);
  if (!p || p.views_enabled === false) return null;
  return p.views_rate_per_1000_minor ?? terms.ratePer1000Minor;
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
