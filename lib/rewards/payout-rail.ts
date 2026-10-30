/**
 * Which rail pays a FRENZ COIN withdrawal (owner, 2026-10-27): "In withdraw, users in Nigeria, Ghana or any country
 * supported by Paystack should use Paystack, but beyond should be Flutterwave and charge by their respective currency."
 *
 * Decided by where the money LANDS (the destination bank's country), never by where the member is browsing from: a
 * Nigerian bank account is paid in naira by Paystack whoever holds it. Paystack Transfers pay into the countries below
 * (its transfer recipient types: NUBAN for Nigeria, GHIPSS / mobile money for Ghana, BASA for South Africa, KEPSS / M-PESA
 * for Kenya) — though only from a Paystack account registered in that same country. Everywhere else: Flutterwave.
 *
 * Exclusive (rewards / SUB) withdrawals keep the admin's payout provider (Admin → SUB → Payout provider) — this is for
 * Frenz Coin only. Pure: no I/O.
 */
export const PAYSTACK_PAYOUT_COUNTRIES: readonly string[] = ["NG", "GH", "ZA", "KE"];

/**
 * HOW A WITHDRAWAL LEAVES — the admin's choice, for Exclusive (Admin → SUB) and Frenz Coin (Admin → Frenz Coin) alike.
 *
 * Owner, 2026-10-29: "Withdrawal must be clean path through the provider selected by admin not two or any backup, I will
 * choose if Flutterwave only, paystack only or Flutterwave and paystack as backup but default to Flutterwave only."
 *
 *   flutterwave                  Flutterwave ONLY. A refusal leaves the withdrawal approved with the money held, for a
 *                                retry once Flutterwave is fixed — nothing is ever sent through Paystack.
 *   paystack                     Paystack ONLY.
 *   flutterwave_paystack_backup  Flutterwave first; Paystack only when Flutterwave DEFINITELY sent nothing (not set up, a
 *                                4xx refusal, or an account-holder mismatch) — the old "Flutterwave" behaviour, now opt-in.
 *
 * Before 2026-10-29 "flutterwave" silently meant the third row, which is how a payout the admin routed to Flutterwave
 * could leave through Paystack. A saved "flutterwave" now means exactly what it says.
 */
export const PAYOUT_ROUTES = ["flutterwave", "paystack", "flutterwave_paystack_backup"] as const;
export type PayoutRoute = (typeof PAYOUT_ROUTES)[number];
export const DEFAULT_PAYOUT_ROUTE: PayoutRoute = "flutterwave";

/** What the admin reads for each route. */
export const PAYOUT_ROUTE_LABELS: Record<PayoutRoute, string> = {
  flutterwave: "Flutterwave only (default)",
  paystack: "Paystack only",
  flutterwave_paystack_backup: "Flutterwave, with Paystack as backup",
};

/** A stored value → a route; anything unknown is the default, Flutterwave only. */
export function normalizePayoutRoute(v: unknown): PayoutRoute {
  return (PAYOUT_ROUTES as readonly unknown[]).includes(v) ? (v as PayoutRoute) : DEFAULT_PAYOUT_ROUTE;
}

/** The rail for a coin payout into a bank in `country` (two letters). Unknown → Flutterwave, the rail that reaches most countries. */
export function coinPayoutRail(country: string | null | undefined): "paystack" | "flutterwave" {
  return PAYSTACK_PAYOUT_COUNTRIES.includes((country ?? "").trim().toUpperCase()) ? "paystack" : "flutterwave";
}

/**
 * The country a withdrawal pays into: its details' own two-letter country when it carries one, else NG for the Nigerian
 * bank method (`paystack` — the member picked their bank from Paystack's Nigerian list), else unknown.
 */
export function payoutDestinationCountry(w: { payout_method?: unknown; payout_details?: unknown }): string | null {
  const c = (w.payout_details as { country?: unknown } | null | undefined)?.country;
  if (typeof c === "string" && /^[A-Za-z]{2}$/.test(c.trim())) return c.trim().toUpperCase();
  return w.payout_method === "paystack" ? "NG" : null;
}
