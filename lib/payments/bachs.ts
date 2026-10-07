import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  BACHS (bachs.io) — the second top-up provider (owner, 2026-10-07)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "Add bachs.io payment provider" — alongside Paystack, the admin picks which
 * takes top-ups (`frenzAiPlans.wallet.provider`). Written against the public
 * docs (docs.bachs.io, read 2026-10-07):
 *
 *   create   POST /v1/checkout-sessions
 *            { pricing: { currency, amount: "10.00" }, customer: { email },
 *              reference, metadata, success_url, cancel_url, expires_in_minutes }
 *            → { checkout_id: "chk_…", checkout_url, status: "open", … }
 *   read     GET  /v1/checkout-sessions/{checkout_id}
 *   webhook  X-Bachs-Signature-V2: "t={unix},v1={hex}" where
 *            v1 = HMAC-SHA256(secret, "{t}.{raw body}"), 300 s tolerance;
 *            envelope { id: "evt_…", type, data }; `collection.succeeded` is
 *            the source of truth for fulfilment, linked by data.checkout_id /
 *            data.reference.
 *
 * Money is a DECIMAL STRING at the currency's precision. Packs are priced in
 * USD; Bachs converts at its own page ("USD is the only currency that converts
 * at the page").
 *
 * Keys (server only, never NEXT_PUBLIC): BACHS_SECRET_KEY (sk_sandbox_… or
 * sk_live_… — the prefix picks the host) and BACHS_WEBHOOK_SECRET (the
 * endpoint's signing secret from the developer portal). Without both, Bachs
 * is off and a top-up says payments are unavailable — never a silent fallback.
 *
 * ⚠️ Not yet exercised against a live Bachs account (no key in this
 * environment on 2026-10-07). The sandbox key is the first test.
 */

const TIMEOUT_MS = 10_000;
export const BACHS_SIGNATURE_TOLERANCE_S = 300;

function secretKey(): string | null {
  const k = process.env.BACHS_SECRET_KEY?.trim();
  return k ? k : null;
}

export function bachsBaseUrl(key: string | null = secretKey()): string {
  const override = process.env.BACHS_API_BASE?.trim();
  if (override) return override.replace(/\/+$/, "");
  return key?.startsWith("sk_live_") ? "https://api.bachs.io" : "https://sandbox-api.bachs.io";
}

/** Both keys present — the only state in which a Bachs checkout may begin (a payment we could not verify must never be taken). */
export function bachsConfigured(): boolean {
  return !!secretKey() && !!process.env.BACHS_WEBHOOK_SECRET?.trim();
}

/** USD cents → "10.00". Integers in, a string out; never a float on the way. */
export function usdCentsToDecimal(cents: number): string {
  const c = Math.max(0, Math.round(cents));
  return `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
}

/** "75000.00" → 7500000 minor units; null when it is not a plain decimal. */
export function decimalToMinor(v: unknown): number | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}

async function bachs<T>(path: string, init: { method: "GET" | "POST" | "DELETE"; body?: unknown; idempotencyKey?: string }): Promise<T> {
  const key = secretKey();
  if (!key) throw new Error("bachs: BACHS_SECRET_KEY is not set");
  const res = await fetch(`${bachsBaseUrl(key)}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.idempotencyKey ? { "Idempotency-Key": init.idempotencyKey } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`bachs ${init.method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

export interface BachsCheckout {
  checkoutId: string;
  url: string;
}

/** A hosted checkout for an exact USD amount. The reference is ours (unique), and doubles as the idempotency key. */
export async function createBachsCheckout(opts: { amountUsdCents: number; email: string; reference: string; metadata: Record<string, string>; successUrl: string; cancelUrl: string }): Promise<BachsCheckout> {
  const out = await bachs<{ checkout_id?: string; checkout_url?: string }>("/v1/checkout-sessions", {
    method: "POST",
    idempotencyKey: opts.reference,
    body: {
      pricing: { currency: "USD", amount: usdCentsToDecimal(opts.amountUsdCents) },
      customer: { email: opts.email },
      reference: opts.reference,
      metadata: opts.metadata,
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
      expires_in_minutes: 60,
    },
  });
  if (!out.checkout_id || !out.checkout_url) throw new Error("bachs: checkout created without an id or a url");
  return { checkoutId: out.checkout_id, url: out.checkout_url };
}

/** The session as Bachs holds it now — for verify-on-return. Only a SUCCEEDED status is ever treated as paid. */
export async function getBachsCheckout(checkoutId: string): Promise<{ status: string; reference: string | null; raw: Record<string, unknown> }> {
  const raw = await bachs<Record<string, unknown>>(`/v1/checkout-sessions/${encodeURIComponent(checkoutId)}`, { method: "GET" });
  return { status: String(raw.status ?? ""), reference: typeof raw.reference === "string" ? raw.reference : null, raw };
}

export function bachsStatusIsPaid(status: unknown): boolean {
  return typeof status === "string" && status.trim().toUpperCase() === "SUCCEEDED";
}

/**
 * 🔴 The webhook's authenticity: `X-Bachs-Signature-V2: t=…,v1=…[,v1=…]`.
 * HMAC-SHA256 of "{t}.{raw body}" with the endpoint secret, compared in
 * constant time, and refused outside the tolerance (a replayed delivery).
 * Any v1 matching passes (Bachs sends two during a secret rotation).
 */
export function verifyBachsSignature(rawBody: string, header: string | null, secret: string, nowMs: number = Date.now()): { ok: true } | { ok: false; reason: "missing" | "malformed" | "stale" | "mismatch" } {
  if (!header || !secret) return { ok: false, reason: "missing" };
  const parts = header.split(",").map((p) => p.trim());
  const t = parts.find((p) => p.startsWith("t="))?.slice(2);
  const sigs = parts.filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || !/^\d+$/.test(t) || sigs.length === 0) return { ok: false, reason: "malformed" };
  if (Math.abs(nowMs / 1000 - Number(t)) > BACHS_SIGNATURE_TOLERANCE_S) return { ok: false, reason: "stale" };
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  const match = sigs.some((s) => {
    if (!/^[0-9a-f]+$/i.test(s)) return false;
    const got = Buffer.from(s, "hex");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
  return match ? { ok: true } : { ok: false, reason: "mismatch" };
}

/** The reference prefix every Bachs top-up carries — so a webhook or a return can never be mistaken for another provider's. */
export const BACHS_TOPUP_PREFIX = "frenz_bachs_topup_";

/* ─────────────────────────── subscriptions (AI plans) ────────────────────── */
/*
  docs.bachs.io/guides/subscriptions (read 2026-10-07): "Subscriptions are
  created through checkout; there is no POST /v1/subscriptions." The product
  must be RECURRING (billing_cycle), created in the Bachs dashboard. Renewals
  are charged off-session by Bachs; a failed renewal moves the subscription to
  past_due and Bachs runs its own recovery. Cancel is
  DELETE /v1/subscriptions/{id} { cancel_at_period_end, reason }.
*/

/** A product as Bachs holds it — for the admin's "Check with Bachs" (needs the key's products:read scope). */
export async function readBachsProduct(productId: string): Promise<{ name: string; amount: string | null; currency: string | null; interval: string | null; recurring: boolean }> {
  const p = await bachs<Record<string, unknown>>(`/v1/products/${encodeURIComponent(productId)}`, { method: "GET" });
  const cycle = (p.billing_cycle ?? p.recurring ?? null) as { interval?: unknown; frequency?: unknown } | null;
  const price = (p.price ?? p.pricing ?? null) as { amount?: unknown; currency?: unknown } | null;
  return {
    name: typeof p.name === "string" ? p.name : productId,
    amount: price && (typeof price.amount === "string" || typeof price.amount === "number") ? String(price.amount) : null,
    currency: price && typeof price.currency === "string" ? price.currency : null,
    interval: cycle && typeof cycle.interval === "string" ? `${cycle.frequency && Number(cycle.frequency) > 1 ? `${cycle.frequency} ` : ""}${cycle.interval}` : null,
    recurring: !!cycle && typeof cycle.interval === "string",
  };
}

/** A hosted checkout that starts a subscription to a recurring product. Billed in USD (the plan's list price). */
export async function createBachsSubscriptionCheckout(opts: { productId: string; email: string; reference: string; metadata: Record<string, string>; successUrl: string; cancelUrl: string }): Promise<BachsCheckout> {
  const out = await bachs<{ checkout_id?: string; checkout_url?: string }>("/v1/checkout-sessions", {
    method: "POST",
    idempotencyKey: opts.reference,
    body: {
      product_cart: [{ product_id: opts.productId, quantity: 1 }],
      customer: { email: opts.email },
      billing_currency: "USD",
      reference: opts.reference,
      metadata: opts.metadata,
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
      expires_in_minutes: 60,
    },
  });
  if (!out.checkout_id || !out.checkout_url) throw new Error("bachs: subscription checkout created without an id or a url");
  return { checkoutId: out.checkout_id, url: out.checkout_url };
}

/** Stop a subscription — at the end of the paid period by default (the member keeps what they paid for). */
export async function cancelBachsSubscription(subscriptionId: string, opts: { atPeriodEnd?: boolean; reason?: string } = {}): Promise<void> {
  await bachs(`/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, { method: "DELETE", body: { cancel_at_period_end: opts.atPeriodEnd !== false, reason: (opts.reason ?? "Customer requested").slice(0, 200) } });
}

/** Bachs subscription status → ours (ai_subscriptions.status). Anything unknown is NOT treated as paid. */
export function bachsSubscriptionStatus(s: unknown): "active" | "trialing" | "past_due" | "canceled" | "expired" | null {
  const v = typeof s === "string" ? s.trim().toLowerCase() : "";
  if (v === "active") return "active";
  if (v === "trialing") return "trialing";
  if (v === "past_due" || v === "unpaid") return "past_due";
  if (v === "canceled" || v === "cancelled") return "canceled";
  if (v === "expired" || v === "ended") return "expired";
  return null;
}
