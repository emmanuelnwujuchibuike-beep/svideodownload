import { safeNext } from "@/lib/auth/safe-next";

/**
 * Input guards shared by every SUB helper (Frenz Exclusive Part 2, 2026-10-16).
 *
 * The routes already validate their params, but the helpers build PostgREST
 * `.or(...)` filter STRINGS from these ids (`hasActiveSub`, `startSubCheckout`,
 * `joinFree`). A future caller that forgot the route-level check would turn a
 * crafted id into a filter injection, so each helper checks for itself.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/** The only reference shape `startSubCheckout` ever creates: `frenz_sub_` + a dashless UUID. */
const REFERENCE_RE = /^frenz_sub_[0-9a-f]{32}$/;

export function isSubReference(v: unknown): v is string {
  return typeof v === "string" && REFERENCE_RE.test(v);
}

/**
 * Where a subscriber lands after paying. One rule for the checkout (which bakes it
 * into Paystack's callback URL) and the return page (which reads it back from the
 * query string, where anyone can edit it): a same-site path, never "//host",
 * "/\host", an absolute URL or a control character. Delegates to `safeNext`.
 */
export function subReturnPath(raw: unknown, fallback = "/"): string {
  return safeNext(typeof raw === "string" ? raw : null, fallback);
}

/**
 * How long an unfinished checkout stays open before "abandoned" is believed.
 * Paystack answers `abandoned` for a transaction the customer has not completed YET
 * (a bank transfer or USSD payment can take many minutes), so a 2-minute-old
 * "abandoned" proves nothing. The ad checkout waits 30 minutes for the same reason
 * (lib/ads-platform/payment-server.ts). Even past this, the failure stays
 * recoverable in SQL (0247): a later verified charge still settles.
 */
export const SUB_ABANDON_GRACE_MS = 30 * 60_000;

export type VerifyOutcome =
  | { kind: "settle" }
  | { kind: "pending" }
  | { kind: "fail"; source: "verify_abandoned" | "verify_failed" | "provider_reversed" };

/** What to do with Paystack's verdict on a checkout of a given age. Pure, so it is tested directly. */
export function classifyVerification(paystackStatus: string | null | undefined, checkoutAgeMs: number): VerifyOutcome {
  if (paystackStatus === "success") return { kind: "settle" };
  // a reversed charge is Paystack's final word: the money went back
  if (paystackStatus === "reversed") return { kind: "fail", source: "provider_reversed" };
  if (paystackStatus === "abandoned" || paystackStatus === "failed") {
    if (!(checkoutAgeMs >= SUB_ABANDON_GRACE_MS)) return { kind: "pending" };
    return { kind: "fail", source: paystackStatus === "abandoned" ? "verify_abandoned" : "verify_failed" };
  }
  // ongoing, pending, queued, processing, unknown: never terminal
  return { kind: "pending" };
}
