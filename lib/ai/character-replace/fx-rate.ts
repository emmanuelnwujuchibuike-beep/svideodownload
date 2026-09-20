/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE LIVE RATE — pure arithmetic and parsing (2026-09-20)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner: "when a user clicks a shortcut deposit of $5 or $10 it converts the
 * price to naira on the Paystack checkout — the rate should be a live rate."
 *
 * The server half (fx-rate-server.ts) fetches and caches; everything here is
 * pure so the arithmetic is testable and shared with the admin readout:
 *
 *   · `parseRateAnswer` reads a provider's JSON into "units of CUR per USD"
 *   · `minorPerUsdFrom` turns that into the integer the checkout uses —
 *     checkout MINOR units per $1 — with the operator's markup applied and
 *     the result rounded to a whole minor unit (₦1,335.69 → 133,569 kobo)
 *
 * The markup exists because a mid-market rate is not what a naira account
 * pays to buy dollars: the provider bill is in USD, and the spread between
 * the two is the operator's to cover. At 0% the operator bears it.
 */

export interface RateAnswer {
  /** Units of the checkout currency per one US dollar, e.g. 1335.69. */
  perUsd: number;
  /** When the provider last updated it, ISO; null when it did not say. */
  asOf: string | null;
}

/** A sane band for a USD→X rate: anything outside is a broken answer, not a market. */
const MIN_PER_USD = 0.01;
const MAX_PER_USD = 1_000_000;

export function saneRate(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= MIN_PER_USD && n <= MAX_PER_USD;
}

/**
 * open.er-api.com — `{ result: "success", rates: { NGN: 1335.69 }, time_last_update_utc }`.
 * The primary source: free, keyless, updated daily.
 */
export function parseErApiAnswer(json: unknown, currency: string): RateAnswer | null {
  if (!json || typeof json !== "object") return null;
  const j = json as { result?: unknown; rates?: Record<string, unknown>; time_last_update_utc?: unknown; time_last_update_unix?: unknown };
  if (j.result !== "success" || !j.rates || typeof j.rates !== "object") return null;
  const rate = j.rates[currency.toUpperCase()];
  if (!saneRate(rate)) return null;
  const unix = typeof j.time_last_update_unix === "number" ? j.time_last_update_unix : null;
  return { perUsd: rate, asOf: unix ? new Date(unix * 1000).toISOString() : null };
}

/**
 * @fawazahmed0/currency-api on jsDelivr — `{ date: "2026-09-19", usd: { ngn: 1331.86 } }`.
 * The fallback: a static file on a CDN, updated daily, no key, no quota.
 */
export function parseFawazAnswer(json: unknown, currency: string): RateAnswer | null {
  if (!json || typeof json !== "object") return null;
  const j = json as { date?: unknown; usd?: Record<string, unknown> };
  if (!j.usd || typeof j.usd !== "object") return null;
  const rate = j.usd[currency.toLowerCase()];
  if (!saneRate(rate)) return null;
  return { perUsd: rate, asOf: typeof j.date === "string" ? `${j.date}T00:00:00.000Z` : null };
}

/** Checkout minor units per $1 after the markup, rounded to a whole minor unit. */
export function minorPerUsdFrom(perUsd: number, markupPercent: number): number {
  const markup = Number.isFinite(markupPercent) ? Math.max(0, Math.min(50, markupPercent)) : 0;
  return Math.max(1, Math.round(perUsd * 100 * (1 + markup / 100)));
}

export type RateSource = "live" | "stored" | "manual";

export interface ResolvedRate {
  /** Checkout minor units per $1 — what quoteCheckout is given. */
  minorPerUsd: number;
  /** The market rate before the markup, units per $1; null for a manual rate. */
  marketPerUsd: number | null;
  markupPercent: number;
  source: RateSource;
  /** When the market rate was fetched, ISO; null for a manual rate. */
  fetchedAt: string | null;
  /** Which provider answered ("er-api", "fawaz"), for the operator. */
  provider: string | null;
}

/** How long a stored last-good rate is still trusted when every provider is down. */
export const STORED_RATE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** How long a fetched rate is reused before asking a provider again. */
export const LIVE_RATE_TTL_MS = 60 * 60 * 1000;
