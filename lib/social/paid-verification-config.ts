/**
 * Paid verification — the admin's settings (owner, 2026-10-22: "make users able to pay for blue
 * verification, and the price can be set by admin"). Stored in `settings` under 'paid_verification'.
 * Pure: the admin form, the API and the server read the same normaliser, and it is tested on its own.
 */

export interface PaidVerificationConfig {
  /** Off by default: nothing can be bought until the admin prices it and switches it on. */
  enabled: boolean;
  /** The price, in US cents (converted to the checkout currency at the live rate, like subscriptions). */
  priceCents: number;
  /** How long a paid tick lasts; 0 = for good. */
  periodDays: number;
}

export const PAID_VERIFICATION_KEY = "paid_verification";

export const PAID_VERIFICATION_DEFAULTS: PaidVerificationConfig = { enabled: false, priceCents: 0, periodDays: 30 };

/** The price bounds: at least $0.50 (a charge below it costs more in fees than it raises), at most $1,000. */
export const PAID_VERIFICATION_PRICE = { minCents: 50, maxCents: 100_000 } as const;
export const PAID_VERIFICATION_MAX_DAYS = 3650;

/** Clamp a stored (possibly hand-edited or partial) value to a safe config. A price outside the bounds switches it off. */
export function normalizePaidVerification(raw: unknown): PaidVerificationConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const price = Math.round(Number(r.priceCents));
  const days = Math.round(Number(r.periodDays));
  const priceCents = Number.isFinite(price) && price >= PAID_VERIFICATION_PRICE.minCents && price <= PAID_VERIFICATION_PRICE.maxCents ? price : 0;
  const periodDays = Number.isFinite(days) && days >= 0 && days <= PAID_VERIFICATION_MAX_DAYS ? days : PAID_VERIFICATION_DEFAULTS.periodDays;
  return { enabled: r.enabled === true && priceCents > 0, priceCents, periodDays };
}

/** The tick's new end: a renewal before expiry extends from the current end; a lapsed or first one starts now. Null = for good. */
export function paidVerificationExpiry(periodDays: number, currentEnd: string | null, now: number): string | null {
  if (periodDays <= 0) return null;
  const end = currentEnd ? Date.parse(currentEnd) : NaN;
  const from = Number.isFinite(end) && end > now ? end : now;
  return new Date(from + periodDays * 86_400_000).toISOString();
}
