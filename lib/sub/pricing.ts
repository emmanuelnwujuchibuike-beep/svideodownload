import { subscriptionCharge, usd, validatePrice } from "@/lib/creator/membership/engine";

/**
 * Exclusive bundles and promotions (bundles & promotions Part 2, 2026-10-24, migration 0277) — the pure maths.
 *
 * Every option is PREPAID: one payment buys `periodDays` of access and nothing renews. The server prices
 * everything from here (startSubCheckout re-reads the creator's prices and the promotion at server time); the
 * browser only ever names a duration and a promotion id.
 *
 *   1 month   the creator's monthly price (creator_membership_settings.sub_price_cents), for the admin's periodDays
 *   3 / 6 / 12 the creator's bundle TOTAL (bundle_prices), for 90 / 180 / 365 days
 *
 * Savings are honest: a bundle that costs as much as (or more than) paying monthly shows no saving at all, never a
 * negative "discount". Amounts are integer US cents, formatted once with `usd`.
 */

export const SUB_DURATIONS = [1, 3, 6, 12] as const;
export type SubMonths = (typeof SUB_DURATIONS)[number];
export const BUNDLE_MONTHS = [3, 6, 12] as const;
export type BundleMonths = (typeof BUNDLE_MONTHS)[number];
export type BundlePrices = Record<BundleMonths, number | null>;

export const isSubMonths = (v: unknown): v is SubMonths => typeof v === "number" && (SUB_DURATIONS as readonly number[]).includes(v);

/** Access days for a duration. 1 month keeps the admin's period (30 by default); the bundles are fixed. 365 stays under 0227's 366-day limit. */
export function periodDaysFor(months: SubMonths, monthlyPeriodDays: number): number {
  return months === 1 ? monthlyPeriodDays : months === 3 ? 90 : months === 6 ? 180 : 365;
}

/** The stored jsonb → a clean record. Anything that is not a positive whole number of cents is "off". */
export function parseBundlePrices(raw: unknown): BundlePrices {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const one = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null);
  return { 3: one(r["3"]), 6: one(r["6"]), 12: one(r["12"]) };
}

/**
 * A bundle total must keep its effective monthly price inside the admin's price bounds — the existing
 * validatePrice rule, scaled by the number of months (a 12-month bundle may total up to 12 × the monthly maximum,
 * and no less than 12 × the minimum).
 */
export function validateBundlePrice(totalCents: number, months: BundleMonths, bounds: { minPriceCents: number; maxPriceCents: number }): { ok: true } | { ok: false; error: string } {
  const min = bounds.minPriceCents * months;
  const max = bounds.maxPriceCents * months;
  const v = validatePrice(totalCents, { minPriceCents: min, maxPriceCents: max });
  return v.ok ? v : { ok: false, error: `Set the ${months}-month price from ${usd(min)} to ${usd(max)}.` };
}

/** The regular (non-promotional) price of a duration, or null when it is not offered. */
export function regularPriceFor(months: SubMonths, monthlyCents: number | null, bundles: BundlePrices): number | null {
  if (!monthlyCents || monthlyCents <= 0) return null;
  return months === 1 ? monthlyCents : bundles[months];
}

/** What one month of a duration costs, rounded to the cent. */
export function effectiveMonthlyCents(totalCents: number, months: SubMonths): number {
  return Math.round(totalCents / months);
}

/** What the same number of months costs paying the monthly price each time. */
export function equivalentMonthlyCost(monthlyCents: number, months: SubMonths): number {
  return monthlyCents * months;
}

/** Cents saved against paying monthly — 0 when the bundle saves nothing (never negative). */
export function savingsCents(totalCents: number, months: SubMonths, monthlyCents: number): number {
  return Math.max(0, equivalentMonthlyCost(monthlyCents, months) - totalCents);
}

/** True only when the option genuinely costs less than paying monthly for the same months. */
export function savesMoney(totalCents: number, months: SubMonths, monthlyCents: number): boolean {
  return savingsCents(totalCents, months, monthlyCents) > 0;
}

/** Whole-percent saving, rounded DOWN so it is never overstated. 0 when nothing is saved. */
export function savingsPercent(totalCents: number, months: SubMonths, monthlyCents: number): number {
  const full = equivalentMonthlyCost(monthlyCents, months);
  return full > 0 ? Math.floor((savingsCents(totalCents, months, monthlyCents) * 100) / full) : 0;
}

// ─── promotions ──────────────────────────────────────────────────────────────

export type PromotionKind = "percent" | "fixed";
export type PromotionStatus = "scheduled" | "active" | "expired" | "paused";

export interface PromotionRule {
  id: string;
  kind: PromotionKind;
  percentOff: number | null;
  fixedPriceCents: number | null;
  durations: SubMonths[];
  startsAt: string;
  endsAt: string;
  maxRedemptions: number | null;
  paused: boolean;
}

/** Computed from the window and the switch at server time — no cron. An ended promotion is expired even if paused. */
export function promotionStatus(p: Pick<PromotionRule, "startsAt" | "endsAt" | "paused">, now: number): PromotionStatus {
  if (now >= Date.parse(p.endsAt)) return "expired";
  if (p.paused) return "paused";
  if (now < Date.parse(p.startsAt)) return "scheduled";
  return "active";
}

/**
 * The promotional price of a duration whose regular price is `regularCents`, or null when the promotion cannot
 * price it (a fixed price above the regular price, or a result that would not be a positive whole number of cents).
 * Percent: the regular price less the percentage, rounded to the nearest cent, never above the regular price and
 * never below 1 cent.
 */
export function promotionPriceCents(p: Pick<PromotionRule, "kind" | "percentOff" | "fixedPriceCents">, regularCents: number): number | null {
  if (!Number.isInteger(regularCents) || regularCents <= 0) return null;
  if (p.kind === "percent") {
    const pct = p.percentOff ?? 0;
    if (!Number.isInteger(pct) || pct < 1 || pct > 90) return null;
    const price = Math.round((regularCents * (100 - pct)) / 100);
    return price >= 1 && price <= regularCents ? price : null;
  }
  const fixed = p.fixedPriceCents ?? 0;
  return Number.isInteger(fixed) && fixed >= 1 && fixed <= regularCents ? fixed : null;
}

/**
 * Can this promotion price this duration right now? Window and pause at server time, the duration, and the limit
 * when the caller knows the live redemption count (the database checks the limit again, atomically, at insert).
 */
export function promotionEligible(p: PromotionRule, months: SubMonths, now: number, liveRedemptions?: number): boolean {
  if (promotionStatus(p, now) !== "active") return false;
  if (!p.durations.includes(months)) return false;
  if (p.maxRedemptions !== null && liveRedemptions !== undefined && liveRedemptions >= p.maxRedemptions) return false;
  return true;
}

export interface PromotionInput {
  name: string;
  description?: string | null;
  kind: PromotionKind;
  percentOff?: number | null;
  fixedPriceCents?: number | null;
  durations: number[];
  startsAt: string;
  endsAt: string;
  maxRedemptions?: number | null;
}

/**
 * A creator's promotion, checked against their CURRENT prices. Returns the cleaned rule or the first problem, in
 * plain words. A fixed price must be positive and no more than the regular price of EVERY chosen duration.
 */
export function validatePromotion(input: PromotionInput, ctx: { monthlyCents: number | null; bundles: BundlePrices; now: number; isNew: boolean }): { ok: true; value: Omit<PromotionRule, "id" | "paused"> & { name: string; description: string | null } } | { ok: false; error: string } {
  const name = (input.name ?? "").trim();
  if (name.length < 1 || name.length > 60 || /[<>]/.test(name)) return { ok: false, error: "Give the promotion a name of up to 60 characters." };
  const description = input.description?.trim() || null;
  if (description && (description.length > 200 || /[<>]/.test(description))) return { ok: false, error: "Keep the description to 200 characters of plain text." };
  const durations = [...new Set(input.durations)].filter(isSubMonths).sort((a, b) => a - b);
  if (!durations.length || durations.length !== new Set(input.durations).size) return { ok: false, error: "Choose which durations the promotion applies to (1, 3, 6 or 12 months)." };
  for (const m of durations) if (regularPriceFor(m, ctx.monthlyCents, ctx.bundles) === null) return { ok: false, error: m === 1 ? "Set your monthly price first." : `Turn on the ${m}-month bundle first, or leave it out of the promotion.` };
  const starts = Date.parse(input.startsAt);
  const ends = Date.parse(input.endsAt);
  if (!Number.isFinite(starts) || !Number.isFinite(ends)) return { ok: false, error: "Choose a start and an end date." };
  if (ends <= starts) return { ok: false, error: "The promotion must end after it starts." };
  if (ctx.isNew && ends <= ctx.now) return { ok: false, error: "The end date has already passed." };
  if (ends - starts > 366 * 86_400_000) return { ok: false, error: "A promotion can run for up to a year." };
  const max = input.maxRedemptions ?? null;
  if (max !== null && (!Number.isInteger(max) || max < 1 || max > 1_000_000)) return { ok: false, error: "The redemption limit must be a whole number of at least 1, or none." };
  if (input.kind === "percent") {
    const pct = input.percentOff ?? NaN;
    if (!Number.isInteger(pct) || pct < 1 || pct > 90) return { ok: false, error: "A percentage discount must be from 1% to 90%." };
    return { ok: true, value: { name, description, kind: "percent", percentOff: pct, fixedPriceCents: null, durations, startsAt: new Date(starts).toISOString(), endsAt: new Date(ends).toISOString(), maxRedemptions: max } };
  }
  if (input.kind === "fixed") {
    const fixed = input.fixedPriceCents ?? NaN;
    if (!Number.isInteger(fixed) || fixed < 1) return { ok: false, error: "A promotional price must be more than $0." };
    for (const m of durations) {
      const regular = regularPriceFor(m, ctx.monthlyCents, ctx.bundles)!;
      if (fixed > regular) return { ok: false, error: `The promotional price can't be more than the regular ${m === 1 ? "monthly" : `${m}-month`} price (${usd(regular)}).` };
    }
    return { ok: true, value: { name, description, kind: "fixed", percentOff: null, fixedPriceCents: fixed, durations, startsAt: new Date(starts).toISOString(), endsAt: new Date(ends).toISOString(), maxRedemptions: max } };
  }
  return { ok: false, error: "Choose a percentage discount or a fixed price." };
}

// ─── the options a subscriber is offered ─────────────────────────────────────

export interface SubOption {
  months: SubMonths;
  periodDays: number;
  /** the regular price of this duration (what the creator set) */
  regularCents: number;
  /** what the subscriber would pay at the regular price (price + fee) — the struck-through total under a promotion */
  regularTotalCents: number;
  /** what the creator receives — the promotional price when a promotion applies */
  priceCents: number;
  feeCents: number;
  /** what the subscriber pays: price + the platform fee */
  totalCents: number;
  /** price ÷ months, rounded */
  effectiveMonthlyCents: number;
  /** honest saving of `priceCents` against paying monthly for the same months (0 = none) */
  savingsCents: number;
  savingsPercent: number;
  promotion: { id: string; name: string; endsAt: string } | null;
}

/**
 * Every duration this creator offers right now, each with its best eligible promotion (the lowest price). The
 * fee is the platform's purchase fee on top of the price, exactly as checkout charges it (subscriptionCharge).
 * `live` is each promotion's live redemption count, when known — an exhausted promotion is left out.
 */
export function subOptions(input: { monthlyCents: number | null; bundles: BundlePrices; periodDays: number; feePercent: number; promotions: PromotionRule[]; live?: Record<string, number>; now: number; promotionNames?: Record<string, string> }): SubOption[] {
  const out: SubOption[] = [];
  if (!input.monthlyCents || input.monthlyCents <= 0) return out;
  for (const months of SUB_DURATIONS) {
    const regular = regularPriceFor(months, input.monthlyCents, input.bundles);
    if (regular === null) continue;
    let price = regular;
    let promotion: SubOption["promotion"] = null;
    for (const p of input.promotions) {
      if (!promotionEligible(p, months, input.now, input.live?.[p.id])) continue;
      const promo = promotionPriceCents(p, regular);
      if (promo !== null && promo < price) {
        price = promo;
        promotion = { id: p.id, name: input.promotionNames?.[p.id] ?? "Promotion", endsAt: p.endsAt };
      }
    }
    const c = subscriptionCharge(price, input.feePercent);
    out.push({
      months,
      periodDays: periodDaysFor(months, input.periodDays),
      regularCents: regular,
      regularTotalCents: subscriptionCharge(regular, input.feePercent).totalCents,
      priceCents: c.priceCents,
      feeCents: c.feeCents,
      totalCents: c.totalCents,
      effectiveMonthlyCents: effectiveMonthlyCents(c.priceCents, months),
      savingsCents: savingsCents(c.priceCents, months, input.monthlyCents),
      savingsPercent: savingsPercent(c.priceCents, months, input.monthlyCents),
      promotion,
    });
  }
  return out;
}

/** "1 month", "3 months" … */
export const durationLabel = (months: SubMonths) => (months === 1 ? "1 month" : `${months} months`);
