import "server-only";

import { randomUUID } from "node:crypto";

import { after } from "next/server";

import { formatCents } from "@/lib/ai/economy";
import { recordTopupAttempt } from "@/lib/ai/topup-attempts";
import { aiCurrencySymbol, getLandingSettings } from "@/lib/landing/settings";
import { CHARACTER_REPLACE_TOPUP_PURPOSE, initializeAiTopup, paystackEnabled } from "@/lib/paystack/paystack";
import { SITE_URL } from "@/lib/site";

/**
 * Begin a recharge of THE Frenz AI balance (the Character Replace product
 * wallet — one wallet since 0155). Shared by /api/ai/character-replace/topup
 * and the older /api/ai/balance/topup, so a member reaching either endpoint
 * pays into the same place under the same rules.
 *
 * 🔴 THE BOUNDS COME FROM THE SERVER'S SETTINGS (config.recharge), never the
 * body. A package is simply an amount inside that window, so a custom amount
 * is judged by the same rule. Nothing here credits anything: the credit
 * happens when Paystack's webhook or the verify-on-return route confirms the
 * payment, idempotently on the reference.
 */
export type TopupStart = { ok: true; url: string } | { ok: false; status: number; error: string };

export async function beginCharacterReplaceTopup(opts: {
  userId: string;
  email: string;
  amountCents: unknown;
  returnTo: unknown;
}): Promise<TopupStart> {
  if (!(await paystackEnabled())) return { ok: false, status: 503, error: "Payments aren't available right now." };

  const settings = await getLandingSettings();
  const { recharge, enabled } = settings.frenzAiCharacterReplace;
  if (!enabled) return { ok: false, status: 503, error: "Character Replace isn't available right now." };
  const symbol = aiCurrencySymbol(settings.frenzAiCurrency);

  const amount = opts.amountCents;
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount < recharge.minCents || amount > recharge.maxCents) {
    return {
      ok: false,
      status: 400,
      error: `Enter an amount between ${formatCents(recharge.minCents, symbol)} and ${formatCents(recharge.maxCents, symbol)}.`,
    };
  }

  const reference = `${CHARACTER_REPLACE_TOPUP_PURPOSE}_${randomUUID()}`;
  try {
    const url = await initializeAiTopup({
      email: opts.email,
      userId: opts.userId,
      amount,
      currency: settings.frenzAiCurrency,
      reference,
      purpose: CHARACTER_REPLACE_TOPUP_PURPOSE,
      callbackUrl: `${SITE_URL}${safeReturnTo(opts.returnTo)}`,
    });
    after(() => recordTopupAttempt({ reference, userId: opts.userId, amountCents: amount, currency: settings.frenzAiCurrency }));
    return { ok: true, url };
  } catch (e) {
    // Never the provider's message: it can carry the request back, with the email in it.
    console.error("[ai/cr/topup] initialize failed", { userId: opts.userId, error: String(e) });
    return { ok: false, status: 502, error: "We couldn't start that payment. Try again." };
  }
}

/** Where Paystack may send the member back. Anything else becomes the workspace. */
const RETURN_PATHS = new Set(["/ai", "/ai/character-replace", "/ai/usage", "/studio/ai", "/studio/ai/character-replace", "/studio/ai/usage"]);
const DEFAULT_RETURN = "/ai/character-replace";

export function safeReturnTo(value: unknown): string {
  return typeof value === "string" && RETURN_PATHS.has(value) ? value : DEFAULT_RETURN;
}
