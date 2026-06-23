import { createHmac, timingSafeEqual } from "node:crypto";

import type { BillingPlan } from "@/lib/monetization/types";

/**
 * Minimal Stripe client over the REST API (no SDK dependency). Dormant unless
 * STRIPE_SECRET_KEY is set, so builds/dev never break.
 *
 * Env:
 *   STRIPE_SECRET_KEY       sk_live_… / sk_test_…
 *   STRIPE_WEBHOOK_SECRET   whsec_…
 *   STRIPE_PRICE_PRO        price_…  ($4.99/mo)
 *   STRIPE_PRICE_BUSINESS   price_…  ($9.99/mo)
 */

const SECRET = process.env.STRIPE_SECRET_KEY?.trim();
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET?.trim();

const PRICE_PRO = process.env.STRIPE_PRICE_PRO?.trim();
const PRICE_BUSINESS = process.env.STRIPE_PRICE_BUSINESS?.trim();

export function stripeEnabled(): boolean {
  return !!SECRET;
}

export function priceForPlan(plan: BillingPlan): string | null {
  if (plan === "pro") return PRICE_PRO ?? null;
  if (plan === "business") return PRICE_BUSINESS ?? null;
  return null;
}

export function planForPrice(priceId: string | undefined | null): BillingPlan {
  if (priceId && priceId === PRICE_BUSINESS) return "business";
  if (priceId && priceId === PRICE_PRO) return "pro";
  return "free";
}

/** Form-encodes nested params the way Stripe's API expects. */
function encode(params: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object" && !Array.isArray(v)) {
      out.push(...encode(v as Record<string, unknown>, key));
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (typeof item === "object") {
          out.push(...encode(item as Record<string, unknown>, `${key}[${i}]`));
        } else {
          out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else {
      out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return out;
}

async function stripe<T = Record<string, unknown>>(
  path: string,
  params?: Record<string, unknown>,
): Promise<T> {
  if (!SECRET) throw new Error("Stripe is not configured");
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SECRET}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params ? encode(params).join("&") : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(json.error?.message || `Stripe ${path} failed`);
  return json;
}

export interface StripeSubscription {
  id: string;
  status: string;
  customer: string;
  cancel_at_period_end: boolean;
  current_period_end: number;
  items: { data: { price: { id: string } }[] };
  metadata?: { user_id?: string };
}

/** Reuse a customer if we already have one, else create with user metadata. */
export async function ensureCustomer(
  existingId: string | null,
  email: string | undefined,
  userId: string,
): Promise<string> {
  if (existingId) return existingId;
  const c = await stripe<{ id: string }>("customers", {
    email,
    metadata: { user_id: userId },
  });
  return c.id;
}

export async function createCheckoutSession(opts: {
  customer: string;
  priceId: string;
  userId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<string> {
  const session = await stripe<{ url: string }>("checkout/sessions", {
    mode: "subscription",
    customer: opts.customer,
    line_items: [{ price: opts.priceId, quantity: 1 }],
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    allow_promotion_codes: true,
    metadata: { user_id: opts.userId },
    subscription_data: { metadata: { user_id: opts.userId } },
  });
  return session.url;
}

export async function createPortalSession(customer: string, returnUrl: string): Promise<string> {
  const session = await stripe<{ url: string }>("billing_portal/sessions", {
    customer,
    return_url: returnUrl,
  });
  return session.url;
}

export async function getSubscription(id: string): Promise<StripeSubscription> {
  if (!SECRET) throw new Error("Stripe is not configured");
  const res = await fetch(`https://api.stripe.com/v1/subscriptions/${id}`, {
    headers: { Authorization: `Bearer ${SECRET}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error("Stripe subscription fetch failed");
  return (await res.json()) as StripeSubscription;
}

/**
 * Verifies a Stripe webhook signature (the SDK's scheme) without the SDK.
 * Compares HMAC-SHA256(`${t}.${payload}`) to the v1 signature, with a tolerance.
 */
export function verifyStripeSignature(
  payload: string,
  header: string | null,
  toleranceSec = 300,
): boolean {
  if (!STRIPE_WEBHOOK_SECRET || !header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((kv) => kv.split("=") as [string, string]),
  );
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) return false;

  const expected = createHmac("sha256", STRIPE_WEBHOOK_SECRET)
    .update(`${t}.${payload}`)
    .digest("hex");
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
  } catch {
    return false;
  }
}
