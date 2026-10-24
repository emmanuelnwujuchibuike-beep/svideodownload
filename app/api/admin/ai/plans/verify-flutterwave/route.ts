import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/guard";
import { FlutterwaveHttpError, readFlutterwavePlan } from "@/lib/flutterwave/client";
import { FLUTTERWAVE_CHECKOUT_CURRENCY, flutterwaveConfigured, getFlutterwaveConfig } from "@/lib/flutterwave/config";
import { getLandingSettings } from "@/lib/landing/settings";
import { getPricing } from "@/lib/monetization/pricing";
import { aiPlanShownUsdCents, displayPriceUsdCents, flutterwavePlanCompat, type PlanCompat } from "@/lib/payments/plan-compat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// `for` (Part 6): which plan the id is meant for — the plan is then checked against the SAVED price members are shown
const schema = z.object({ id: z.string().trim().min(1).max(20), for: z.enum(["ai_pro", "ai_max", "pro", "business"]).optional() });

/** The same compatibility rule the checkouts apply (lib/payments/plan-compat.ts), against the saved shown price. */
async function compatFor(target: "ai_pro" | "ai_max" | "pro" | "business", plan: Awaited<ReturnType<typeof readFlutterwavePlan>>): Promise<PlanCompat> {
  if (target === "pro" || target === "business") return flutterwavePlanCompat(plan, { amountMinor: displayPriceUsdCents((await getPricing())[target].price), interval: "monthly" });
  const s = await getLandingSettings();
  const ai = s.frenzAiPlans.plans[target];
  return flutterwavePlanCompat(plan, { amountMinor: aiPlanShownUsdCents(ai.priceCents, s.frenzAiCurrency), interval: ai.interval });
}

/**
 * POST /api/admin/ai/plans/verify-flutterwave — admin-only, the Flutterwave twin of "Check with Paystack"
 * (owner, 2026-10-23: plans configurable by admin like Paystack). Reads a payment-plan id back from Flutterwave
 * (GET /v3/payment-plans/{id}: name, amount, currency, interval, status) so the AI Plans card shows what a member
 * will actually be charged — and warns when the plan isn't USD (it would never be used) — before the id is saved.
 * Read-only: nothing is created or charged.
 */
export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!flutterwaveConfigured(await getFlutterwaveConfig())) return NextResponse.json({ ok: false, error: "Flutterwave is not configured (Monetization → Flutterwave: add the secret key)." }, { status: 200 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Enter a plan id." }, { status: 400 });
  const id = parsed.data.id;
  if (!/^\d{1,12}$/.test(id)) {
    return NextResponse.json({ ok: false, error: `"${id.slice(0, 20)}" is not a Flutterwave plan id. It is a number (Flutterwave dashboard → Payments → Payment plans → the plan).` }, { status: 200 });
  }
  try {
    const plan = await readFlutterwavePlan(id);
    const compat = parsed.data.for ? await compatFor(parsed.data.for, plan) : null;
    return NextResponse.json({ ok: true, plan, usable: compat ? compat.ok : plan.active && plan.currency === FLUTTERWAVE_CHECKOUT_CURRENCY, compat, checkoutCurrency: FLUTTERWAVE_CHECKOUT_CURRENCY });
  } catch (e) {
    const notFound = e instanceof FlutterwaveHttpError && e.httpStatus >= 400 && e.httpStatus < 500;
    return NextResponse.json({ ok: false, error: notFound ? "Flutterwave does not know this plan id on the configured account (check live vs test keys, and that the plan was not cancelled)." : "Flutterwave did not answer. Try again in a moment." }, { status: 200 });
  }
}
