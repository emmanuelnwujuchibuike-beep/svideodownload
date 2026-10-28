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
