import { createHash, createPublicKey, verify as verifySignature, type KeyObject } from "node:crypto";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FAL.AI WEBHOOKS — proving the callback is really from fal
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The endpoint (/api/webhooks/fal) is public — fal calls it from their
 * infrastructure. Without verification, anyone who guesses the URL can POST
 * `{"request_id":"…","status":"OK","payload":{"video":{"url":"https://…"}}}`
 * and the handler would mark somebody's job complete with a stranger's file.
 * The request id is not a secret (it is in our own logs). The signature is
 * the only thing standing between "a request arrived" and "fal sent this".
 *
 * ── The scheme (fal.ai docs, "Webhooks → verification", read 2026-09-21) ────
 *
 *   headers   X-Fal-Webhook-Request-Id · X-Fal-Webhook-User-Id
 *             X-Fal-Webhook-Timestamp  · X-Fal-Webhook-Signature (hex)
 *   message   requestId \n userId \n timestamp \n sha256hex(raw body)
 *             — the JOINED STRING itself is signed (not hashed again)
 *   key       ED25519, published as JWKS at https://rest.fal.ai/.well-known/jwks.json
 *             (`x` = base64url of the raw 32-byte public key; several keys
 *             may be live, any one verifying is enough)
 *   window    the timestamp must be within ±5 minutes of now
 *
 * Three details that are easy to get wrong and each fatal:
 *
 *   1. The body hash is over the RAW bytes as received — the route reads
 *      `request.text()` and verifies BEFORE `JSON.parse`.
 *   2. The keys ROTATE: every key in the set is tried, and a set that fails
 *      to verify is refreshed once (lib/ai/fal/jwks.ts) before the delivery
 *      is refused.
 *   3. The timestamp is a replay guard, not a clock check: a captured
 *      delivery re-sent an hour later is refused even though it is
 *      genuinely signed.
 *
 * Pure and dependency-free (node:crypto verifies Ed25519 natively), so the
 * one function that decides whether to trust a stranger is tested directly
 * with a key pair the test generates.
 */

export const FAL_WEBHOOK_TOLERANCE_SECONDS = 5 * 60;
export const FAL_JWKS_URL = "https://rest.fal.ai/.well-known/jwks.json";

export interface FalWebhookHeaders {
  requestId: string | null;
  userId: string | null;
  timestamp: string | null;
  signature: string | null;
}

export function readFalWebhookHeaders(headers: Headers): FalWebhookHeaders {
  return {
    requestId: headers.get("x-fal-webhook-request-id"),
    userId: headers.get("x-fal-webhook-user-id"),
    timestamp: headers.get("x-fal-webhook-timestamp"),
    signature: headers.get("x-fal-webhook-signature"),
  };
}

export type FalWebhookVerdict = { valid: true; keyIndex: number } | { valid: false; reason: "missing-headers" | "stale" | "bad-signature" | "no-keys" | "no-match" };

export interface FalJwk {
  kty?: string;
  crv?: string;
  x?: string;
  kid?: string;
}

/** The message fal signed, built exactly as their reference implementation builds it. */
export function falSignedMessage(h: { requestId: string; userId: string; timestamp: string }, rawBody: string | Uint8Array): Buffer {
  const bodyHash = createHash("sha256").update(rawBody).digest("hex");
  return Buffer.from([h.requestId, h.userId, h.timestamp, bodyHash].join("\n"), "utf8");
}

/** A JWK's raw Ed25519 public key as a node KeyObject; null for anything that is not one. */
export function falPublicKey(jwk: FalJwk): KeyObject | null {
  if (!jwk || typeof jwk.x !== "string" || !jwk.x) return null;
  if (jwk.kty && jwk.kty !== "OKP") return null;
  if (jwk.crv && jwk.crv !== "Ed25519") return null;
  try {
    return createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: jwk.x }, format: "jwk" });
  } catch {
    return null;
  }
}

export function verifyFalWebhook(opts: { headers: FalWebhookHeaders; rawBody: string | Uint8Array; keys: readonly FalJwk[]; nowSeconds?: number; toleranceSeconds?: number }): FalWebhookVerdict {
  const { requestId, userId, timestamp, signature } = opts.headers;
  if (!requestId || !userId || !timestamp || !signature) return { valid: false, reason: "missing-headers" };

  const ts = Number(timestamp);
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = opts.toleranceSeconds ?? FAL_WEBHOOK_TOLERANCE_SECONDS;
  if (!Number.isFinite(ts) || Math.abs(now - ts) > tolerance) return { valid: false, reason: "stale" };

  if (!/^[0-9a-fA-F]+$/.test(signature) || signature.length % 2 !== 0) return { valid: false, reason: "bad-signature" };
  const sig = Buffer.from(signature, "hex");
  // An Ed25519 signature is 64 bytes; anything else cannot verify and is not worth a key walk.
  if (sig.length !== 64) return { valid: false, reason: "bad-signature" };

  const message = falSignedMessage({ requestId, userId, timestamp }, opts.rawBody);
  let sawKey = false;
  for (let i = 0; i < opts.keys.length; i++) {
    const key = falPublicKey(opts.keys[i]!);
    if (!key) continue;
    sawKey = true;
    try {
      // Ed25519 takes the message itself (no digest algorithm) — `null` is the documented first argument.
      if (verifySignature(null, message, key, sig)) return { valid: true, keyIndex: i };
    } catch {
      /* a malformed key: try the next */
    }
  }
  return { valid: false, reason: sawKey ? "no-match" : "no-keys" };
}
