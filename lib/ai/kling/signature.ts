import { createHmac, timingSafeEqual } from "node:crypto";

import { KLING_CALLBACK_TOLERANCE_SECONDS, KLING_JWT_NOT_BEFORE_SKEW_SECONDS, KLING_JWT_TTL_SECONDS } from "@/lib/ai/kling/config";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  KLING — signing what we send, and proving what we receive
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Two unrelated jobs that both happen to be HMAC, kept in one file because
 * both are the "is this really us / really them" boundary and both must be
 * testable without a network or a key from the console.
 *
 *   OUTBOUND   `klingJwt()` mints the 30-minute HS256 token the legacy
 *              AccessKey/SecretKey surface expects. A deployment on the
 *              new-standard API key never calls it.
 *
 *   INBOUND    `verifyKlingCallback()` decides whether a POST to
 *              /api/webhooks/kling really came from Kling.
 *
 * Pure and dependency-free (`node:crypto` does HMAC natively), so the one
 * function that decides whether to trust a stranger is tested directly.
 */

/* ══════════════════════ OUTBOUND — the AK/SK JWT ═══════════════════════════ */

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface KlingJwtClaims {
  iss: string;
  exp: number;
  nbf: number;
}

/**
 * The claims Kling's documented scheme asks for: the ACCESS key is the
 * issuer, the token lives thirty minutes, and `nbf` sits a few seconds in the
 * past so a clock a little ahead of ours cannot reject a token we just made.
 *
 * Separated from the signing so a test can assert the claims without ever
 * needing a secret.
 */
export function klingJwtClaims(accessKey: string, nowSeconds: number = Math.floor(Date.now() / 1000)): KlingJwtClaims {
  return {
    iss: accessKey,
    exp: nowSeconds + KLING_JWT_TTL_SECONDS,
    nbf: nowSeconds - KLING_JWT_NOT_BEFORE_SKEW_SECONDS,
  };
}

/**
 * One HS256 JWT.
 *
 * 🔴 The secret key is the signing key and never appears in the token, in a
 * log line, in an error or in anything returned to a caller. The token itself
 * is a bearer credential for thirty minutes — it is handed straight to
 * `fetch` and is never stored, never returned and never logged either.
 */
export function klingJwt(opts: { accessKey: string; secretKey: string; nowSeconds?: number }): string {
  const accessKey = opts.accessKey.trim();
  const secretKey = opts.secretKey.trim();
  if (!accessKey || !secretKey) throw new Error("kling: an access key and a secret key are both required to mint a token");

  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify(klingJwtClaims(accessKey, opts.nowSeconds)));
  const signingInput = `${header}.${payload}`;
  const signature = base64url(createHmac("sha256", secretKey).update(signingInput).digest());
  return `${signingInput}.${signature}`;
}

/* ═════════════════════ INBOUND — verifying a callback ══════════════════════ */

/**
 * ── ⚠️ TWO PUBLISHED SCHEMES, SO BOTH ARE IMPLEMENTED ───────────────────────
 *
 * Kling's console issues a "Webhook Secret" and signs callbacks with it. The
 * sources that could be read on 2026-09-28 describe the wire format two
 * different ways, and the official page could not be read (see the note in
 * config.ts):
 *
 *   A · Standard Webhooks — headers `webhook-id`, `webhook-timestamp`,
 *       `webhook-signature`; the signed content is `id.timestamp.body`;
 *       the signature header carries one or more space-separated
 *       `v1,<base64>` values so a secret can be rotated without an outage.
 *   B · a single `sha256=<hex>` HMAC over the RAW body, in a vendor-named
 *       header.
 *
 * Accepting both is not sloppiness: each is checked with the FULL strictness
 * of its own scheme, an unrecognised shape is a refusal rather than a pass,
 * and the route treats a callback it could not verify as UNTRUSTED — it
 * re-reads the task from Kling with our own credentials instead of believing
 * the body. So the cost of the ambiguity is one extra API read, never a
 * forged completion.
 *
 * Whichever scheme the live console turns out to use, Part 3 can delete the
 * other and lose nothing.
 */

export interface KlingCallbackHeaders {
  /** Standard Webhooks (scheme A). */
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  /** The vendor-named single HMAC (scheme B). */
  simpleSignature: string | null;
}

export function readKlingCallbackHeaders(headers: Headers): KlingCallbackHeaders {
  const first = (...names: string[]): string | null => {
    for (const n of names) {
      const v = headers.get(n);
      if (v) return v;
    }
    return null;
  };
  return {
    id: first("webhook-id", "x-kling-webhook-id", "x-kling-request-id"),
    timestamp: first("webhook-timestamp", "x-kling-webhook-timestamp", "x-kling-timestamp"),
    signature: first("webhook-signature", "x-kling-webhook-signature"),
    simpleSignature: first("x-kling-signature", "kling-signature"),
  };
}

export type KlingCallbackVerdict =
  | { valid: true; scheme: "standard-webhooks" | "sha256" }
  | { valid: false; reason: "no-secret" | "missing-headers" | "stale" | "bad-signature" | "no-match" };

/** A constant-time compare that never throws on a length mismatch. */
function equals(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

/**
 * The signing key.
 *
 * A Standard Webhooks secret is conventionally `whsec_<base64>` and the raw
 * bytes are what sign; a plain string signs as its own UTF-8 bytes. Both are
 * handled, because a secret pasted from a console with or without its prefix
 * must not silently fail to verify.
 */
export function klingSigningKey(secret: string): Buffer {
  const s = secret.trim();
  if (s.startsWith("whsec_")) {
    const raw = s.slice("whsec_".length);
    const decoded = Buffer.from(raw, "base64");
    // A base64 body that round-trips is the raw key; anything else is a literal secret that merely starts with the prefix.
    if (decoded.length > 0 && decoded.toString("base64").replace(/=+$/, "") === raw.replace(/=+$/, "")) return decoded;
  }
  return Buffer.from(s, "utf8");
}

/** Scheme A's signed content: the delivery id, the timestamp and the RAW body, joined by dots. */
export function klingStandardWebhookContent(id: string, timestamp: string, rawBody: string): string {
  return `${id}.${timestamp}.${rawBody}`;
}

export function verifyKlingCallback(opts: {
  headers: KlingCallbackHeaders;
  rawBody: string;
  secret: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): KlingCallbackVerdict {
  const secret = opts.secret?.trim();
  if (!secret) return { valid: false, reason: "no-secret" };

  const key = klingSigningKey(secret);
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = opts.toleranceSeconds ?? KLING_CALLBACK_TOLERANCE_SECONDS;
  const { id, timestamp, signature, simpleSignature } = opts.headers;

  /* ── scheme A · Standard Webhooks ──────────────────────────────────────── */
  if (signature) {
    if (!id || !timestamp) return { valid: false, reason: "missing-headers" };
    const ts = Number(timestamp);
    // 🔴 A replay guard, not a clock check: a genuine delivery captured and re-sent later is still refused.
    if (!Number.isFinite(ts) || Math.abs(now - ts) > tolerance) return { valid: false, reason: "stale" };

    const expected = createHmac("sha256", key).update(klingStandardWebhookContent(id, timestamp, opts.rawBody)).digest();
    // Several versioned signatures may be present during a secret rotation; any one matching is enough.
    const candidates = signature
      .split(/\s+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => (part.includes(",") ? part.slice(part.indexOf(",") + 1) : part))
      .filter(Boolean);
    if (candidates.length === 0) return { valid: false, reason: "bad-signature" };
    for (const candidate of candidates) {
      let sig: Buffer;
      try {
        sig = Buffer.from(candidate, "base64");
      } catch {
        continue;
      }
      if (equals(sig, expected)) return { valid: true, scheme: "standard-webhooks" };
    }
    return { valid: false, reason: "no-match" };
  }

  /* ── scheme B · a single sha256 HMAC over the raw body ─────────────────── */
  if (simpleSignature) {
    const raw = simpleSignature.trim();
    const hex = raw.toLowerCase().startsWith("sha256=") ? raw.slice("sha256=".length) : raw;
    if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) return { valid: false, reason: "bad-signature" };
    // When this scheme carries a timestamp, it is honoured; when it does not, there is nothing to replay-check.
    if (timestamp) {
      const ts = Number(timestamp);
      if (!Number.isFinite(ts) || Math.abs(now - ts) > tolerance) return { valid: false, reason: "stale" };
    }
    const expected = createHmac("sha256", key).update(opts.rawBody).digest();
    return equals(Buffer.from(hex, "hex"), expected) ? { valid: true, scheme: "sha256" } : { valid: false, reason: "no-match" };
  }

  return { valid: false, reason: "missing-headers" };
}

/** Sign a body the way scheme A does — for tests, and for nothing else. */
export function signKlingCallbackForTest(opts: { id: string; timestamp: string; rawBody: string; secret: string }): string {
  const key = klingSigningKey(opts.secret);
  const sig = createHmac("sha256", key).update(klingStandardWebhookContent(opts.id, opts.timestamp, opts.rawBody)).digest("base64");
  return `v1,${sig}`;
}

/** Sign a body the way scheme B does — for tests, and for nothing else. */
export function signKlingSimpleForTest(opts: { rawBody: string; secret: string }): string {
  return `sha256=${createHmac("sha256", klingSigningKey(opts.secret)).update(opts.rawBody).digest("hex")}`;
}
