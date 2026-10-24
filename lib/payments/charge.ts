/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A VERIFIED CHARGE — what a provider told OUR SERVER about a payment (pure)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Part 2 (Flutterwave). Every field here was fetched from the provider by the
 * server with its secret key; none of it comes from a browser or from a
 * webhook body on its own. Settlement code compares it with the attempt WE
 * stored before the checkout opened (`chargeMatches`), so the provider's word
 * is checked against our own record and not against metadata a client could
 * have influenced.
 */
import type { TopupProviderId } from "@/lib/ai/credits/wallet-config";

/**
 * The outcome in one vocabulary for every provider:
 *   success    the money moved
 *   failed     the charge was attempted and refused
 *   abandoned  the checkout was closed/cancelled without paying
 *   pending    still in progress (bank transfer, OTP…) — never final
 *   not_found  the provider holds no transaction for our reference
 */
export type ChargeStatus = "success" | "failed" | "abandoned" | "pending" | "not_found";

export interface VerifiedCharge {
  provider: TopupProviderId;
  /** OUR merchant reference, as the provider echoed it (Flutterwave `tx_ref`). */
  reference: string | null;
  /** The provider's own transaction id (Flutterwave `data.id`). */
  externalId: string | null;
  status: ChargeStatus;
  /** Minor units of `currency` — what the provider says settled for the merchant amount. */
  amountMinor: number | null;
  currency: string | null;
  channel: string | null;
  paidAt: string | null;
  /** The provider's customer-facing line ("Approved", "Insufficient funds"…), when there is one. */
  reason: string | null;
  /** The paying customer's email as the provider recorded it (lowercased) — ties a Flutterwave renewal to its subscriber. */
  customerEmail?: string | null;
}

export interface ExpectedCharge {
  provider: TopupProviderId;
  reference: string;
  /** Minor units we asked for. */
  amountMinor: number;
  currency: string;
}

/**
 * Why a verified charge does not pay for the attempt. `underpaid` / `overpaid` are the amount in
 * the RIGHT currency but not the exact amount; `amount` is an amount that is missing or not a
 * whole number of minor units.
 */
export type ChargeMismatch = "provider" | "reference" | "currency" | "amount" | "underpaid" | "overpaid" | "status";

/**
 * Does a verified charge PAY for the attempt we stored? Part 2.1 (2026-10-23): EXACTLY. All of:
 * the same provider, our exact reference, a success, the same currency, and the SAME amount — in
 * integer minor units of that currency, no tolerance. The first failing check is returned (for the
 * audit log).
 *
 * An overpayment is NOT an ordinary payment: it grants nothing here and goes to review (the caller
 * holds the attempt as a mismatch), so no extra value is ever granted and a person decides on the
 * refund of the difference. An underpayment, another currency, another reference or provider, or
 * anything but a success never grants anything.
 */
export function chargeMatches(charge: VerifiedCharge, expected: ExpectedCharge): { ok: true } | { ok: false; mismatch: ChargeMismatch } {
  if (charge.provider !== expected.provider) return { ok: false, mismatch: "provider" };
  if (charge.reference !== expected.reference) return { ok: false, mismatch: "reference" };
  if (charge.status !== "success") return { ok: false, mismatch: "status" };
  if ((charge.currency ?? "").toUpperCase() !== expected.currency.toUpperCase()) return { ok: false, mismatch: "currency" };
  const paid = charge.amountMinor;
  if (typeof paid !== "number" || !Number.isSafeInteger(paid) || !Number.isSafeInteger(expected.amountMinor)) return { ok: false, mismatch: "amount" };
  if (paid < expected.amountMinor) return { ok: false, mismatch: "underpaid" };
  if (paid > expected.amountMinor) return { ok: false, mismatch: "overpaid" };
  return { ok: true };
}
