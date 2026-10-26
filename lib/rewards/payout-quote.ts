import "server-only";

import { marketRate } from "@/lib/ai/character-replace/fx-rate-server";
import { getLandingSettings } from "@/lib/landing/settings";
import { createAdminClient } from "@/lib/supabase/admin";

import { koboFor } from "./paystack-banks";

/**
 * What a withdrawal pays out in naira, for both payout rails (lib/rewards/flutterwave-payouts.ts, paystack-payouts.ts).
 *
 *   AI credits / SUB   exactly as before: the withdrawal's USD value at the live NGN market rate, no markup.
 *   Frenz Coin         an OWNER decision (frenzCoin.withdrawals.payoutRateSource), never assumed:
 *                        "none"   (default) no coin payout can be sent — said plainly, nothing is sent;
 *                        "fixed"  payoutMinorPerUsd — usually already fixed on the withdrawal when it was requested;
 *                        "market" the same live market rate as above, no markup.
 *                      The amount and how it was worked out are recorded ONCE on the withdrawal before anything is sent
 *                      (0283 record_coin_payout_quote): a retried payout pays the recorded amount, never a new one.
 */
type Row = Record<string, unknown>;
export type PayoutQuote = { ok: true; kobo: number; label: string } | { ok: false; error: string };

export async function payoutQuote(w: Row): Promise<PayoutQuote> {
  if (w.source === "coin") return coinPayoutQuote(w);
  const rate = await marketRate("NGN");
  if (!rate) return { ok: false, error: "No naira rate is available right now. Try again shortly." };
  return { ok: true, kobo: koboFor(Number(w.amount_usd_cents ?? 0), rate.rate.perUsd), label: `${rate.rate.perUsd} per USD (${rate.source})` };
}

const NO_RATE = "Frenz Coin payouts need an approved naira rate (Admin → Frenz Coin → withdrawals: payout rate). Nothing was sent.";

async function coinPayoutQuote(w: Row): Promise<PayoutQuote> {
  const id = String(w.id ?? "");
  const net = Number(w.net_cents ?? w.amount_usd_cents ?? 0);
  // already recorded (fixed at request, or quoted by an earlier attempt): that amount, whatever the settings say now
  const recorded = Number(w.payout_minor ?? 0);
  if (recorded > 0 && w.payout_currency === "NGN") return { ok: true, kobo: recorded, label: describe(w.payout_fx, "fixed at request") };
  let source: "none" | "fixed" | "market" = "none";
  let fixed: number | null = null;
  try {
    const c = (await getLandingSettings()).frenzCoin.withdrawals;
    source = c.payoutRateSource;
    fixed = c.payoutMinorPerUsd;
  } catch {
    return { ok: false, error: "Couldn't read the payout settings. Nothing was sent." };
  }
  let kobo: number;
  let fx: Record<string, unknown>;
  if (source === "fixed") {
    if (!fixed) return { ok: false, error: NO_RATE };
    // the same integer rule as 0279 request_coin_withdrawal: floor(net × minor-per-USD / 100)
    kobo = Number((BigInt(Math.trunc(net)) * BigInt(fixed)) / 100n);
    fx = { source: "fixed", minorPerUsd: fixed, netCents: net, at: new Date().toISOString() };
  } else if (source === "market") {
    const rate = await marketRate("NGN");
    if (!rate) return { ok: false, error: "No naira rate is available right now. Try again shortly." };
    kobo = koboFor(net, rate.rate.perUsd);
    fx = { source: "market", provider: rate.source, perUsd: rate.rate.perUsd, netCents: net, at: new Date().toISOString() };
  } else {
    return { ok: false, error: NO_RATE };
  }
  if (!(kobo > 0)) return { ok: false, error: "The payout amount works out to nothing. Nothing was sent." };
  const { data, error } = await createAdminClient().rpc("record_coin_payout_quote", { p_id: id, p_minor: kobo, p_currency: "NGN", p_fx: fx });
  const r = (data ?? {}) as { ok?: boolean; reason?: string; payout_minor?: number; payout_fx?: unknown };
  if (error || !r.ok || !(Number(r.payout_minor) > 0)) return { ok: false, error: "Couldn't record the payout amount, so nothing was sent." };
  return { ok: true, kobo: Number(r.payout_minor), label: describe(r.payout_fx, source) };
}

function describe(fx: unknown, fallback: string): string {
  const f = (fx ?? {}) as { source?: string; perUsd?: number; minorPerUsd?: number; provider?: string };
  if (f.source === "market" && f.perUsd) return `${f.perUsd} per USD (market${f.provider ? `, ${f.provider}` : ""})`;
  if (f.source === "fixed" && f.minorPerUsd) return `${(f.minorPerUsd / 100).toFixed(2)} per USD (fixed)`;
  return fallback;
}
