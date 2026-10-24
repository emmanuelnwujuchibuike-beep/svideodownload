import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/require-admin";
import { requireSensitiveAdmin } from "@/lib/admin/reauth";
import { FLUTTERWAVE_CHECKOUT_CURRENCY, FLUTTERWAVE_PURPOSES, flutterwaveCheckoutGate, readStoredFlutterwave, resolveFlutterwaveConfig, setFlutterwaveConfig } from "@/lib/flutterwave/config";
import { SITE_URL } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin: configure Flutterwave from the dashboard (owner, 2026-10-23: "configure the Flutterwave webhook,
 * APIs and all just like the paystack does"). Stored in the PRIVATE `payment_provider_settings` table
 * (0272: service role only) — never `settings`, which admin sessions can read. The secrets are
 * write-only: GET returns a mask and where each value comes from (dashboard / env / not set).
 */

/** A hint of a secret, never the value: its prefix (FLWSECK_TEST- / FLWSECK-) and last 4. */
function mask(v: string): string {
  if (!v) return "";
  if (v.length <= 12) return "••••••";
  return `${v.slice(0, v.startsWith("FLWSECK") ? 13 : 3)}…${v.slice(-4)}`;
}

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const stored = await readStoredFlutterwave();
  const cfg = resolveFlutterwaveConfig(process.env, stored);
  const env = resolveFlutterwaveConfig(process.env, null);
  const source = (dash: unknown, envVal: unknown) => (dash ? "dashboard" : envVal ? "env" : "none");
  const gates = Object.fromEntries(FLUTTERWAVE_PURPOSES.map((p) => [p, flutterwaveCheckoutGate(p, FLUTTERWAVE_CHECKOUT_CURRENCY, cfg)]));
  return NextResponse.json({
    mode: cfg.secretKey ? cfg.mode : null,
    secretSet: !!cfg.secretKey,
    secretMasked: mask(cfg.secretKey),
    secretSource: source(stored?.secretKey, env.secretKey),
    hashSet: !!cfg.secretHash,
    hashMasked: mask(cfg.secretHash),
    hashSource: source(stored?.secretHash, env.secretHash),
    verifiedCurrencies: cfg.verifiedCurrencies,
    enabledPurposes: cfg.enabledPurposes,
    amountUnitConfirmed: cfg.amountUnitConfirmed,
    // Pro / Business site plans: their Flutterwave payment-plan ids (not secrets)
    sitePlanPro: cfg.sitePlanPro,
    sitePlanBusiness: cfg.sitePlanBusiness,
    checkoutCurrency: FLUTTERWAVE_CHECKOUT_CURRENCY,
    webhookUrl: `${SITE_URL}/api/flutterwave/webhook`,
    // per purpose: open, or the exact reason it is closed (not_configured, amount_unit_unconfirmed, …)
    gates,
    // the table exists once migration 0272 has run; before it, only env works
    storageReady: stored !== null || (await tableReachable()),
  });
}

async function tableReachable(): Promise<boolean> {
  try {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { error } = await createAdminClient().from("payment_provider_settings").select("provider").limit(1);
    return !error;
  } catch {
    return false;
  }
}

const schema = z
  .object({
    // blank = keep the saved one (the form never re-sends a secret)
    secretKey: z.string().trim().max(200).regex(/^(|FLWSECK(_TEST)?-[A-Za-z0-9-]{8,190})$/, "That doesn't look like a Flutterwave secret key (FLWSECK_TEST-… or FLWSECK-…).").optional(),
    secretHash: z.string().trim().max(200).regex(/^(|[A-Za-z0-9_\-]{16,200})$/, "The webhook secret hash must be 16+ letters, digits, - or _.").optional(),
    clearSecretKey: z.boolean().optional(),
    clearSecretHash: z.boolean().optional(),
    verifiedCurrencies: z.array(z.string().regex(/^[A-Z]{3}$/)).max(10).optional(),
    enabledPurposes: z.array(z.enum(FLUTTERWAVE_PURPOSES)).max(10).optional(),
    amountUnit: z.enum(["", "major", "unconfirmed"]).optional(),
    // a Flutterwave payment-plan id is digits; blank = that site plan is Paystack only
    sitePlanPro: z.string().trim().regex(/^(|\d{1,12})$/, "A Flutterwave plan id is a number.").optional(),
    sitePlanBusiness: z.string().trim().regex(/^(|\d{1,12})$/, "A Flutterwave plan id is a number.").optional(),
  })
  .strict();

export async function POST(request: Request) {
  // SENSITIVE: whoever controls the payment keys controls where money goes — a fresh password on top of the session (lib/admin/reauth.ts)
  const gate = await requireSensitiveAdmin();
  if (!gate.ok) return gate.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload." }, { status: 400 });
  try {
    const admin = await getAdminUser();
    await setFlutterwaveConfig(parsed.data, admin?.id ?? null);
    return NextResponse.json({ ok: true });
  } catch {
    // never the error detail: it could echo the payload
    return NextResponse.json({ error: "Couldn't save the Flutterwave settings. Has migration 0272 been run?" }, { status: 500 });
  }
}
