"use client";

import type { AiPlansPublic } from "@/lib/ai/credits/config";

/**
 * The browser's reads of the AI plan and its allowance (0167). Display
 * only: every figure comes from the server and every decision that spends
 * is /start's. `no-store` on the request too — a poll answered from the
 * HTTP cache once showed a finished job as running (the 2026-09-14 lesson).
 */

export interface AiCreditEntitlementView {
  plan: "ai_pro" | "ai_max" | null;
  planLabel: string | null;
  dailyLimit: number;
  weeklyLimit: number;
  usedToday: number;
  usedThisWeek: number;
  remainingToday: number;
  remainingThisWeek: number;
  dayResetsAt: string;
  weekResetsAt: string;
  timezone: string;
  subscription: { plan: "ai_pro" | "ai_max"; status: string; active: boolean; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; manageable: boolean; provider?: "paystack" | "bachs" } | null;
}

export interface AiCreditLedgerView {
  id: number;
  jobId: string;
  feature: string;
  plan: "ai_pro" | "ai_max";
  reserved: number;
  consumed: number;
  refunded: number;
  status: "reserved" | "settled" | "released";
  dayKey: string;
  weekKey: string;
  at: string;
  updatedAt: string;
}

export interface AiCreditsAnswer {
  plans: AiPlansPublic;
  entitlement: AiCreditEntitlementView;
  ledger: AiCreditLedgerView[];
}

type Result<T> = ({ ok: true } & T) | { ok: false; code: string; error: string };

async function request<T>(input: RequestInfo, init?: RequestInit): Promise<Result<T>> {
  let res: Response;
  try {
    res = await fetch(input, { cache: "no-store", ...init });
  } catch {
    return { ok: false, code: "NETWORK", error: "You appear to be offline. Try again in a moment." };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* handled below */
  }
  if (!res.ok) {
    const b = (body ?? {}) as { code?: string; error?: string };
    return { ok: false, code: b.code ?? "INTERNAL_ERROR", error: b.error ?? "Something went wrong. Try again in a moment." };
  }
  return { ok: true, ...((body ?? {}) as T) };
}

export function getAiCredits(opts?: { ledger?: number }): Promise<Result<AiCreditsAnswer>> {
  const q = opts?.ledger ? `?ledger=${Math.max(1, Math.min(100, Math.floor(opts.ledger)))}` : "";
  return request<AiCreditsAnswer>(`/api/ai/credits${q}`);
}

/** Begin an AI plan checkout: the server answers Paystack's hosted page; the browser navigates there. */
export function beginAiPlanCheckout(plan: "ai_pro" | "ai_max", returnTo: string, provider?: "paystack" | "bachs" | null): Promise<Result<{ url: string }>> {
  return request<{ url: string }>("/api/ai/subscriptions/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan, returnTo, ...(provider ? { provider } : {}) }) });
}

/** Back from Paystack: the server reads the charge by its reference and activates the plan only if it is genuine. */
export function verifyAiPlanReturn(reference: string): Promise<Result<{ activated: boolean; plan?: "ai_pro" | "ai_max"; planLabel?: string; status?: string; reason?: string | null; dailyLimit?: number; weeklyLimit?: number }>> {
  return request(`/api/ai/subscriptions/verify?reference=${encodeURIComponent(reference)}`);
}

/** A Bachs-billed plan: stop it at the end of the paid period (Bachs has no hosted manage page). */
export function cancelAiPlan(): Promise<Result<{ endsAt?: string | null; alreadyCanceled?: boolean }>> {
  return request("/api/ai/subscriptions/cancel", { method: "POST" });
}

/** Paystack's hosted page for the member's AI plan (card, cancellation). */
export function openAiPlanManage(): Promise<Result<{ url: string }>> {
  return request<{ url: string }>("/api/ai/subscriptions/manage", { method: "POST" });
}

/**
 * The return from an AI PLAN checkout, taken once (and removed from the URL).
 *
 * 🔴 2026-10-07: only when `ai_plan` is in the address — every plan checkout
 * puts it there (the Paystack callback and both Bachs URLs). This used to claim
 * ANY `?reference=`, so on the credits page — the return target of every
 * wallet top-up — a deposit's reference was taken as a plan return, checked by
 * the plan route (which refuses a top-up), and the top-up verify never ran: a
 * paid deposit waited for the webhook alone and a cancelled one stayed
 * "pending" forever with no notice (@chris, four in a day). A wallet top-up's
 * reference is left for `takeTopupReturnReference`.
 */
export function takeAiPlanReturn(): { plan: string | null; reference: string | null } | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const plan = params.get("ai_plan");
  const reference = params.get("reference") ?? params.get("trxref");
  if (!plan) return null;
  for (const k of ["ai_plan", "reference", "trxref"]) params.delete(k);
  const rest = params.toString();
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
  return { plan, reference };
}
