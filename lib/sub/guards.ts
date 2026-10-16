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

/*
  ── Exclusive posts: who may know a post exists (Frenz Exclusive Part 3, 0248) ──
  'locked' (the default): a viewer without access may see the public tile — cover, date, count.
  'hidden': a viewer without access gets nothing at all, not even the id. Filtered on the
  server before any response is built; never a CSS hide.
*/
export type SubAudience = "locked" | "hidden";
export const SUB_AUDIENCES: readonly SubAudience[] = ["locked", "hidden"];
export const isSubAudience = (v: unknown): v is SubAudience => v === "locked" || v === "hidden";
/** Before 0248 there is no audience column: every post behaves as 'locked', as it always did. */
export const audienceOf = (v: unknown): SubAudience => (v === "hidden" ? "hidden" : "locked");
export const visibleTo = (audience: SubAudience, access: boolean): boolean => access || audience !== "hidden";

/*
  ── Keyset cursors ──────────────────────────────────────────────────────────
  Pages are ordered by (created_at desc, id desc). The cursor is the last row's pair, opaque
  to the browser (base64url). The timestamp is kept exactly as Postgres wrote it (microseconds
  included): rounding it would skip or repeat posts that share a millisecond. Both halves are
  validated before they go anywhere near a filter string.
*/
const PG_TS = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/;

export interface SubCursor {
  at: string;
  /** null = a pre-Part-3 cursor (a bare timestamp), still accepted */
  id: string | null;
}

export function encodeSubCursor(at: string, id: string): string {
  return Buffer.from(`${at}|${id}`, "utf8").toString("base64url");
}

export function decodeSubCursor(raw: string | null | undefined): SubCursor | null | "invalid" {
  if (!raw) return null;
  if (raw.length > 200) return "invalid";
  // the older gallery cursor: a bare timestamp
  if (PG_TS.test(raw)) return { at: raw, id: null };
  let text: string;
  try {
    text = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    return "invalid";
  }
  const [at, id, extra] = text.split("|");
  if (extra !== undefined || !at || !id || !PG_TS.test(at) || !isUuid(id)) return "invalid";
  return { at, id };
}

/** The PostgREST filter for "after this cursor" in (created_at desc, id desc) order. Inputs are validated by decodeSubCursor. */
export function afterCursorFilter(c: { at: string; id: string }): string {
  return `created_at.lt."${c.at}",and(created_at.eq."${c.at}",id.lt.${c.id})`;
}
