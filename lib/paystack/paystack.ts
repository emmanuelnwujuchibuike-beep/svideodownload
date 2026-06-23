import { createHmac, timingSafeEqual } from "node:crypto";

import type { BillingPlan } from "@/lib/monetization/types";

/**
 * Minimal Paystack client over the REST API (no SDK). Dormant unless
 * PAYSTACK_SECRET_KEY is set, so builds/dev never break.
 *
 * Env:
 *   PAYSTACK_SECRET_KEY    sk_live_… / sk_test_…
 *   PAYSTACK_PLAN_PRO      PLN_…  (Pro plan code from the Paystack dashboard)
 *   PAYSTACK_PLAN_BUSINESS PLN_…  (Business plan code)
 *
 * Paystack signs webhooks with HMAC-SHA512 of the raw body using the SECRET key.
 */

const SECRET = process.env.PAYSTACK_SECRET_KEY?.trim();
const PLAN_PRO = process.env.PAYSTACK_PLAN_PRO?.trim();
const PLAN_BUSINESS = process.env.PAYSTACK_PLAN_BUSINESS?.trim();

const BASE = "https://api.paystack.co";

export function paystackEnabled(): boolean {
  return !!SECRET;
}

export function planCodeForPlan(plan: BillingPlan): string | null {
  if (plan === "pro") return PLAN_PRO ?? null;
  if (plan === "business") return PLAN_BUSINESS ?? null;
  return null;
}

export function planForPlanCode(code: string | undefined | null): BillingPlan {
  if (code && code === PLAN_BUSINESS) return "business";
  if (code && code === PLAN_PRO) return "pro";
  return "free";
}

async function paystack<T = Record<string, unknown>>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  if (!SECRET) throw new Error("Paystack is not configured");
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${SECRET}`,
      "Content-Type": "application/json",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json()) as T & { status?: boolean; message?: string };
  if (!res.ok || json.status === false) {
    throw new Error(json.message || `Paystack ${path} failed`);
  }
  return json;
}

/** The plan's amount (in kobo). Paystack's initialize requires an amount even
 * when a plan is passed, so we read it from the plan to stay correct. */
async function planAmount(planCode: string): Promise<number | undefined> {
  try {
    const p = await paystack<{ data: { amount: number } }>(`/plan/${planCode}`);
    return p.data?.amount;
  } catch {
    return undefined;
  }
}

/**
 * Starts a subscription checkout: initialize a transaction tied to a plan and
 * return Paystack's hosted authorization URL to redirect the user to.
 */
export async function initializeTransaction(opts: {
  email: string;
  planCode: string;
  userId: string;
  callbackUrl: string;
}): Promise<string> {
  const amount = await planAmount(opts.planCode);
  const data = await paystack<{ data: { authorization_url: string } }>(
    "/transaction/initialize",
    {
      method: "POST",
      body: {
        email: opts.email,
        plan: opts.planCode,
        // Required by the API; the plan amount governs the actual charge.
        ...(amount != null ? { amount } : {}),
        callback_url: opts.callbackUrl,
        metadata: { user_id: opts.userId },
      },
    },
  );
  return data.data.authorization_url;
}

/** Hosted link for a member to update card / cancel their subscription. */
export async function subscriptionManageLink(subscriptionCode: string): Promise<string> {
  const data = await paystack<{ data: { link: string } }>(
    `/subscription/${subscriptionCode}/manage/link`,
  );
  return data.data.link;
}

export function verifyPaystackSignature(payload: string, header: string | null): boolean {
  if (!SECRET || !header) return false;
  const hash = createHmac("sha512", SECRET).update(payload).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(hash), Buffer.from(header));
  } catch {
    return false;
  }
}

/** Shapes of the webhook payloads we care about. */
export interface PaystackEventData {
  customer?: { email?: string; customer_code?: string };
  plan?: { plan_code?: string };
  subscription_code?: string;
  email_token?: string;
  next_payment_date?: string;
  status?: string;
  metadata?: { user_id?: string };
}
