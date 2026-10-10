/**
 * Collected revenue — money that actually arrived (owner, 2026-10-10: "include
 * funding revenue in the admin revenue page, include it in the total revenue
 * and not just subscribers").
 *
 * Read from ai_topup_attempts, the one table every rail settles into: AI credit
 * funding (wallet_topup), AI subscriptions (ai_subscription) and advertiser
 * payments (ad_campaign), status "success" only. An admin test campaign never
 * appears here — it has no payment attempt at all.
 *
 * Kept per CURRENCY: NGN and USD are never added together (a sum across them
 * would be a number that means nothing). Pure aggregation, so it is tested.
 */
export type RevenueSource = "funding" | "ai_subscription" | "advertisers";

export const REVENUE_SOURCE_LABELS: Record<RevenueSource, string> = {
  funding: "AI credit funding",
  ai_subscription: "AI subscriptions",
  advertisers: "Advertisers",
};

export function sourceOf(purpose: string | null | undefined): RevenueSource {
  if (purpose === "ad_campaign") return "advertisers";
  if (purpose === "ai_subscription") return "ai_subscription";
  return "funding";
}

export interface CollectedWindow {
  total: number;
  bySource: Record<RevenueSource, number>;
  payments: number;
}

export interface CollectedRevenue {
  /** per currency code: minor units */
  currencies: Record<string, { today: CollectedWindow; d7: CollectedWindow; d30: CollectedWindow; all: CollectedWindow }>;
}

const empty = (): CollectedWindow => ({ total: 0, bySource: { funding: 0, ai_subscription: 0, advertisers: 0 }, payments: 0 });

export function aggregateCollected(rows: readonly { amount_cents: number; currency: string; purpose: string | null; created_at: string }[], now: number): CollectedRevenue {
  const d = new Date(now);
  const today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const out: CollectedRevenue = { currencies: {} };
  for (const r of rows) {
    const cur = (r.currency || "?").toUpperCase();
    const c = (out.currencies[cur] ??= { today: empty(), d7: empty(), d30: empty(), all: empty() });
    const t = Date.parse(r.created_at);
    const src = sourceOf(r.purpose);
    const add = (w: CollectedWindow) => {
      w.total += Number(r.amount_cents);
      w.bySource[src] += Number(r.amount_cents);
      w.payments += 1;
    };
    add(c.all);
    if (t >= now - 30 * 86_400_000) add(c.d30);
    if (t >= now - 7 * 86_400_000) add(c.d7);
    if (t >= today) add(c.today);
  }
  return out;
}
