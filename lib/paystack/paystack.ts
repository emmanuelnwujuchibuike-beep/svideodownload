import { createHmac, timingSafeEqual } from "node:crypto";

import { getPaystackConfig } from "@/lib/paystack/config";
import type { BillingPlan } from "@/lib/monetization/types";

/**
 * Minimal Paystack client over the REST API (no SDK). Dormant unless a secret key
 * is configured — and the config now comes from the ADMIN DASHBOARD (the `settings`
 * table, key `paystack`), falling back to the legacy env vars. See lib/paystack/config.ts.
 *
 * Paystack signs webhooks with HMAC-SHA512 of the raw body using the SECRET key.
 */

const BASE = "https://api.paystack.co";

export async function paystackEnabled(): Promise<boolean> {
  const { secretKey } = await getPaystackConfig();
  return !!secretKey;
}

export async function planCodeForPlan(plan: BillingPlan): Promise<string | null> {
  const { planPro, planBusiness } = await getPaystackConfig();
  if (plan === "pro") return planPro || null;
  if (plan === "business") return planBusiness || null;
  return null;
}

export async function planForPlanCode(code: string | undefined | null): Promise<BillingPlan> {
  const { planPro, planBusiness } = await getPaystackConfig();
  if (code && code === planBusiness) return "business";
  if (code && code === planPro) return "pro";
  return "free";
}

async function paystack<T = Record<string, unknown>>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const { secretKey } = await getPaystackConfig();
  if (!secretKey) throw new Error("Paystack is not configured");
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${secretKey}`,
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

export async function verifyPaystackSignature(payload: string, header: string | null): Promise<boolean> {
  const { secretKey } = await getPaystackConfig();
  if (!secretKey || !header) return false;
  const hash = createHmac("sha512", secretKey).update(payload).digest("hex");
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
