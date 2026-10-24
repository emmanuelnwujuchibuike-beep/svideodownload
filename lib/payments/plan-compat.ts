import type { FlutterwavePlanFacts } from "@/lib/flutterwave/client";
import { FLUTTERWAVE_CHECKOUT_CURRENCY } from "@/lib/flutterwave/config";

/**
 * Part 6 — may a Flutterwave PAYMENT PLAN take this subscription, at the price the member is SHOWN?
 *
 * Found in the Part 6 audit: both plan checkouts charged the Flutterwave plan's own fixed amount without comparing it with
 * the price on the page — AI Pro / Max against the plan's `priceCents`, Pro / Business against the /pricing display
 * price. A USD plan at another amount would have charged members, silently, something they were never shown. Now a plan
 * is used only when it is active, in USD, on the same interval, with a fixed amount EQUAL to the shown price; otherwise
 * Flutterwave refuses before anything is created (Paystack, which charges its own plan, may take it — the existing
 * definite-refusal rule) and the exact reason is logged and shown by Admin → "Check with Flutterwave".
 *
 * Pure: the caller supplies the facts it read from Flutterwave and the price it shows.
 */
export type PlanIncompatibility = "inactive" | "currency" | "no_fixed_amount" | "price_unknown" | "amount_mismatch" | "interval_mismatch";
export type PlanCompat = { ok: true } | { ok: false; reason: PlanIncompatibility; detail: string };

const fmt = (minor: number) => `${FLUTTERWAVE_CHECKOUT_CURRENCY} ${(minor / 100).toFixed(2)}`;

export function flutterwavePlanCompat(facts: Pick<FlutterwavePlanFacts, "active" | "currency" | "amountMinor" | "interval">, shown: { amountMinor: number | null; interval: "monthly" | "yearly" }): PlanCompat {
  if (!facts.active) return { ok: false, reason: "inactive", detail: "The Flutterwave plan is not active." };
  if (facts.currency !== FLUTTERWAVE_CHECKOUT_CURRENCY) return { ok: false, reason: "currency", detail: `The Flutterwave plan is in ${facts.currency || "an unknown currency"}; Flutterwave charges ${FLUTTERWAVE_CHECKOUT_CURRENCY} here. Create the plan in ${FLUTTERWAVE_CHECKOUT_CURRENCY}.` };
  if (!(facts.amountMinor && facts.amountMinor > 0)) return { ok: false, reason: "no_fixed_amount", detail: "The Flutterwave plan has no fixed amount; renewals must be at a known price." };
  if (shown.amountMinor === null) return { ok: false, reason: "price_unknown", detail: `The price members are shown is not a ${FLUTTERWAVE_CHECKOUT_CURRENCY} amount, so it can't be proven equal to the plan's ${fmt(facts.amountMinor)}.` };
  if (facts.amountMinor !== shown.amountMinor) return { ok: false, reason: "amount_mismatch", detail: `The Flutterwave plan charges ${fmt(facts.amountMinor)} but members are shown ${fmt(shown.amountMinor)}. Make them equal (edit the plan, or the shown price).` };
  const interval = String(facts.interval ?? "").trim().toLowerCase();
  const normalized = interval === "annually" ? "yearly" : interval;
  if (normalized && normalized !== shown.interval) return { ok: false, reason: "interval_mismatch", detail: `The Flutterwave plan renews ${interval}; this plan is sold ${shown.interval}.` };
  return { ok: true };
}

/**
 * A /pricing display price ("$4.99", "US$ 9.99", "4.99" — which the page shows as "$4.99") as US cents; null when it is
 * not a plain US-dollar amount ("₦2,500", "Free", "4,99 €"). Never guesses a conversion.
 */
export function displayPriceUsdCents(display: string | null | undefined): number | null {
  const s = String(display ?? "").trim();
  const m = s.match(/^(?:US\$|USD|\$)?\s*(\d{1,6})(?:\.(\d{1,2}))?$/i);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}

/** An AI plan's shown price in US cents — only when the AI price list itself is in USD. */
export function aiPlanShownUsdCents(priceCents: number, listCurrency: string): number | null {
  return String(listCurrency).toUpperCase() === FLUTTERWAVE_CHECKOUT_CURRENCY && Number.isInteger(priceCents) && priceCents > 0 ? priceCents : null;
}
