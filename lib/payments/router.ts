import type { PaymentMarket, PaymentPurpose, PaymentRouting, TopupProviderId } from "@/lib/ai/credits/wallet-config";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE PAYMENT ROUTER — which rail takes this payment (pure)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-10-07: "Do not hard-code provider selection in pages … Do not
 * trust a country value sent from the client." Two rails since 2026-10-23:
 * Flutterwave first (USD, when its account capability is confirmed) and
 * Paystack as the backup (NGN). The router stays the one place a provider is
 * chosen.
 *
 * The ONE place a provider is chosen. Every paid flow asks `routePayment`
 * with the purpose; the market comes from `paymentMarket(headers)`, which
 * reads only what the edge sets. The browser never names a provider, a
 * country, an amount or a number of credits.
 *
 * The answer is an ORDERED list of candidates: the primary if it is usable,
 * then the fallback. A caller moves to the next candidate ONLY when the
 * previous one could not CREATE a checkout (nothing was shown to the member,
 * so nothing can have been paid). Once a checkout exists, there is no
 * fallback — two open checkouts for one purchase is how somebody pays twice.
 */

/**
 * The member's market, from the edge only. `cf-ipcountry` first: Cloudflare
 * sits in front of the site and overwrites it, whereas `x-vercel-ip-country`
 * behind Cloudflare is Cloudflare's own egress country. `x-country` (which a
 * client can set) is deliberately NOT read here, unlike the ads helper.
 *
 * ⚠️ A request that reaches the origin around Cloudflare could forge the
 * header. The consequence is only WHICH legitimate rail is offered — the price
 * and the credits are the server's either way.
 */
export function paymentMarket(headers: Headers): PaymentMarket {
  return paymentCountry(headers) === "NG" ? "NG" : "other";
}

/** The edge's two-letter country, the same trust as `paymentMarket` ("" when the edge sent none). */
export function paymentCountry(headers: Headers): string {
  const c = (headers.get("cf-ipcountry") || headers.get("x-vercel-ip-country") || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : "";
}

export function routePayment(input: {
  purpose: PaymentPurpose;
  market: PaymentMarket;
  routing: PaymentRouting;
  usable: (p: TopupProviderId) => boolean;
  /**
   * The member's pick from the sheet (2026-10-07, when the admin lets members
   * choose). Only REORDERS what the route already allows — a provider the
   * route does not offer, or one that is not usable, is ignored, never added.
   */
  preferred?: unknown;
}): TopupProviderId[] {
  const route = input.routing[input.market][input.purpose];
  const order = [route.primary, ...(route.fallback ? [route.fallback] : [])];
  const allowed = order.filter((p, i) => order.indexOf(p) === i && input.usable(p));
  const pick = allowed.find((p) => p === input.preferred);
  return pick ? [pick, ...allowed.filter((p) => p !== pick)] : allowed;
}

/** The providers a sheet may offer this member for a purpose: the route's usable ones, in the route's order. A choice is shown only when there are two. */
export function offeredProviders(input: { purpose: PaymentPurpose; market: PaymentMarket; routing: PaymentRouting; usable: (p: TopupProviderId) => boolean; memberChoice: boolean }): TopupProviderId[] {
  const all = routePayment(input);
  return input.memberChoice ? all : all.slice(0, 1);
}

/**
 * The result of trying ONE rail. `definite` refusals (nothing was created at the provider)
 * may move to the next rail; `unknown` outcomes may not — a checkout may exist and be paid.
 */
export type RailAttempt<T> = { ok: true; value: T } | { ok: false; refusal: "definite" | "unknown"; status: number; error: string };

/**
 * Try the router's candidates in order, moving on ONLY after a definite refusal. The same rule
 * as the ads' `firstCheckout`, for the flows that do not use its PaymentStart shape.
 */
export async function firstRail<T>(candidates: readonly TopupProviderId[], attempt: (p: TopupProviderId, index: number) => Promise<RailAttempt<T>>, log: (from: TopupProviderId, to: TopupProviderId) => void = () => {}): Promise<RailAttempt<T>> {
  let last: RailAttempt<T> = { ok: false, refusal: "definite", status: 503, error: "Payments aren't available right now." };
  for (const [i, p] of candidates.entries()) {
    last = await attempt(p, i);
    if (last.ok || last.refusal === "unknown") return last;
    const next = candidates[i + 1];
    if (next) log(p, next);
  }
  return last;
}
