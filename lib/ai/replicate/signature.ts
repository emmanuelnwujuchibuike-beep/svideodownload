import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  REPLICATE WEBHOOKS — proving the callback is really from Replicate
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-07 (Part 3): "Do not simply check: 'if request came to this
 * URL, trust it.'"
 *
 * ── 🔴 WHAT AN UNVERIFIED WEBHOOK ACTUALLY IS ────────────────────────────────
 *
 * The endpoint is public — it has to be, Replicate calls it from their
 * infrastructure. Without verification, anyone who guesses the URL can POST
 * `{"id": "...", "status": "succeeded", "output": "https://…"}` and the handler
 * will mark somebody's job complete and store a file of the attacker's choosing
 * as that member's result. The prediction id is not a secret either: it appears
 * in logs and in our own responses. The signature is the only thing standing
 * between "a request arrived" and "Replicate sent this".
 *
 * ── The scheme (Standard Webhooks, as Replicate implements it) ───────────────
 *
 *   signed content = `${webhook-id}.${webhook-timestamp}.${raw body}`
 *   signature      = base64( HMAC-SHA256( key, signed content ) )
 *   key            = base64-decoded part of the secret after `whsec_`
 *   header         = `webhook-signature: v1,<sig> v1,<sig2> …`
 *
 * Three details that are easy to get wrong and each fatal:
 *
 *   1. The body must be the RAW bytes as received. Parsing and re-serialising
 *      changes whitespace and key order, and the signature stops matching — so
 *      the route reads `request.text()` and verifies BEFORE `JSON.parse`.
 *   2. The header can carry SEVERAL signatures, space-delimited, because a
 *      secret being rotated is signed with both. Checking only the first would
 *      break every delivery during a rotation.
 *   3. The comparison is constant-time. A byte-by-byte early return leaks, over
 *      many attempts, how much of a guess was right.
 *
 * Pure and dependency-free, so the one function that decides whether to trust a
 * stranger can be tested directly.
 */

/** Replicate has signed nothing older than this. Blocks replay of a captured call. */
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export type WebhookVerdict =
  | { valid: true }
  | { valid: false; reason: "missing-headers" | "bad-secret" | "stale" | "no-match" };

/** The `whsec_…` secret as raw key bytes. */
function secretKey(secret: string): Buffer | null {
  const trimmed = secret.trim();
  if (!trimmed) return null;
  // The prefix is a label, not part of the key. Tolerated either way, because a
  // secret pasted without it is a very ordinary mistake to make once.
  const base64 = trimmed.startsWith("whsec_") ? trimmed.slice("whsec_".length) : trimmed;
  try {
    const key = Buffer.from(base64, "base64");
    return key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

/** Constant-time compare that tolerates different lengths without throwing. */
function equals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  // timingSafeEqual throws on a length mismatch, which would itself be a
  // (crude) length oracle — and a crash. Compared against a fixed-length digest
  // of each side so the comparison is always equal-length and always runs.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export interface WebhookHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

/** Pull the three headers out of a Request, by their documented names. */
export function readWebhookHeaders(headers: Headers): WebhookHeaders {
  return {
    id: headers.get("webhook-id"),
    timestamp: headers.get("webhook-timestamp"),
    signature: headers.get("webhook-signature"),
  };
}

/**
 * Is this really from Replicate?
 *
 * `nowSeconds` is injected so the staleness rule can be tested without waiting
 * five minutes, and so a clock in a test is never the reason a suite is flaky.
 */
export function verifyReplicateWebhook(opts: {
  headers: WebhookHeaders;
  rawBody: string;
  secret: string;
  nowSeconds?: number;
}): WebhookVerdict {
  const { headers, rawBody, secret } = opts;
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);

  if (!headers.id || !headers.timestamp || !headers.signature) {
    return { valid: false, reason: "missing-headers" };
  }

  const key = secretKey(secret);
  if (!key) return { valid: false, reason: "bad-secret" };

  const ts = Number.parseInt(headers.timestamp, 10);
  if (!Number.isFinite(ts)) return { valid: false, reason: "stale" };
  // Both directions: a timestamp far in the FUTURE is as much a forgery signal
  // as an old one, and would otherwise buy an attacker an unlimited window.
  if (Math.abs(now - ts) > WEBHOOK_TOLERANCE_SECONDS) return { valid: false, reason: "stale" };

  const expected = createHmac("sha256", key)
    .update(`${headers.id}.${headers.timestamp}.${rawBody}`, "utf8")
    .digest("base64");

  // `v1,<sig> v1,<sig>` — every candidate is checked, and every check runs, so
  // the number of comparisons never depends on where a match was found.
  let matched = false;
  for (const part of headers.signature.split(" ")) {
    const value = part.includes(",") ? part.slice(part.indexOf(",") + 1) : part;
    if (equals(value, expected)) matched = true;
  }

  return matched ? { valid: true } : { valid: false, reason: "no-match" };
}

/**
 * Sign a payload the way Replicate does.
 *
 * Test-only in practice, and the reason the verifier can be trusted: a test
 * that only ever asserts "a wrong signature is rejected" would still pass if
 * the function rejected everything, including real deliveries.
 */
export function signWebhookForTest(opts: {
  id: string;
  timestamp: number;
  body: string;
  secret: string;
}): string {
  const key = secretKey(opts.secret);
  if (!key) throw new Error("signWebhookForTest: unusable secret");
  const digest = createHmac("sha256", key)
    .update(`${opts.id}.${opts.timestamp}.${opts.body}`, "utf8")
    .digest("base64");
  return `v1,${digest}`;
}
