import { createAdminClient } from "@/lib/supabase/admin";

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY;

const CURRENCY = process.env.MONETIZATION_CURRENCY || "$";
const PRICE_PRO = Number(process.env.MONETIZATION_MRR_PRO || 4.99);
const PRICE_BUSINESS = Number(process.env.MONETIZATION_MRR_BUSINESS || 9.99);

const sinceIso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const startOfTodayIso = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

export interface Subscriber {
  email: string;
  plan: string;
  status: string;
  provider: string;
}

/** Active/trialing subscribers with their email — for the admin members list. */
export async function fetchSubscribers(): Promise<Subscriber[]> {
  if (!hasSupabase) return [];
  try {
    const db = createAdminClient();
    const { data: subs } = await db
      .from("subscriptions")
      .select("user_id, plan, status, provider, updated_at")
      .in("status", ["active", "trialing"])
      .order("updated_at", { ascending: false })
      .limit(100);
    if (!subs?.length) return [];
    const ids = subs.map((s) => s.user_id);
    const { data: profs } = await db.from("profiles").select("id, email").in("id", ids);
    const emailById = new Map((profs ?? []).map((p) => [p.id as string, p.email as string]));
    return subs.map((s) => ({
      email: emailById.get(s.user_id as string) ?? (s.user_id as string),
      plan: s.plan as string,
      status: s.status as string,
      provider: (s.provider as string) ?? "—",
    }));
  } catch {
    return [];
  }
}

export interface RevenueStats {
  currency: string;
  mrr: number;
  subscribers: { pro: number; business: number; total: number };
  ads: { impressionsToday: number; clicksToday: number; impr7d: number; clicks7d: number; ctr: number };
  affiliate: { clicksToday: number; clicks7d: number };
  api: { callsToday: number; calls7d: number; activeKeys: number };
}

const AD_ZONES = [
  "global",
  "homepage_top",
  "download_result_page",
  "result_top",
  "reward_video",
  "sidebar",
  "exit_intent_popup",
  "mobile_bottom_banner",
] as const;

export interface MonetizationAnalytics {
  totals: { affiliateClicks7d: number; adClicks7d: number; adImpressions7d: number; ctr: number };
  adZones: { zone: string; impressions: number; clicks: number; ctr: number }[];
  topAffiliates: { id: string; name: string; clicks: number }[];
}

/**
 * Click/impression analytics for the admin dashboard: per-zone ad CTR (7d) and
 * top-performing affiliates (30d). Admin-only; runs on the dynamic /admin page.
 */
export async function fetchMonetizationAnalytics(): Promise<MonetizationAnalytics | null> {
  if (!hasSupabase) return null;
  try {
    const s = createAdminClient();
    const week = sinceIso(7 * 864e5);
    const month = sinceIso(30 * 864e5);
    const headCount = (table: string) => s.from(table).select("*", { count: "exact", head: true });

    // Per-zone ad impressions + clicks (7d).
    const adZonesRaw = await Promise.all(
      AD_ZONES.map(async (zone) => {
        const [impr, clk] = await Promise.all([
          headCount("ad_impressions").eq("zone", zone).gte("created_at", week),
          headCount("ad_clicks").eq("zone", zone).gte("created_at", week),
        ]);
        const impressions = impr.count ?? 0;
        const clicks = clk.count ?? 0;
        return {
          zone,
          impressions,
          clicks,
          ctr: impressions > 0 ? Math.round((clicks / impressions) * 1000) / 10 : 0,
        };
      }),
    );

    // Top affiliates by clicks (30d) — bounded to the first 30 offers.
    const { data: offers } = await s.from("affiliate_offers").select("id, name").limit(30);
    const topRaw = await Promise.all(
      (offers ?? []).map(async (o) => {
        const { count } = await headCount("affiliate_clicks")
          .eq("offer_id", o.id as string)
          .gte("created_at", month);
        return { id: o.id as string, name: o.name as string, clicks: count ?? 0 };
      }),
    );

    const [affTot, adClkTot, adImprTot] = await Promise.all([
      headCount("affiliate_clicks").gte("created_at", week),
      headCount("ad_clicks").gte("created_at", week),
      headCount("ad_impressions").gte("created_at", week),
    ]);
    const adImpr = adImprTot.count ?? 0;
    const adClk = adClkTot.count ?? 0;

    return {
      totals: {
        affiliateClicks7d: affTot.count ?? 0,
        adClicks7d: adClk,
        adImpressions7d: adImpr,
        ctr: adImpr > 0 ? Math.round((adClk / adImpr) * 1000) / 10 : 0,
      },
      adZones: adZonesRaw.filter((z) => z.impressions > 0 || z.clicks > 0),
      topAffiliates: topRaw.filter((t) => t.clicks > 0).sort((a, b) => b.clicks - a.clicks).slice(0, 8),
    };
  } catch {
    return null;
  }
}

/** Aggregates monetization metrics for the admin dashboard. */
export async function fetchRevenueStats(): Promise<RevenueStats | null> {
  if (!hasSupabase) return null;
  try {
    const s = createAdminClient();
    const today = startOfTodayIso();
    const week = sinceIso(7 * 864e5);
    const head = (table: string) => s.from(table).select("*", { count: "exact", head: true });

    const [
      proCount,
      bizCount,
      imprToday,
      clicksToday,
      impr7d,
      clicks7d,
      affToday,
      aff7d,
      apiToday,
      api7d,
      keys,
    ] = await Promise.all([
      head("subscriptions").eq("plan", "pro").in("status", ["active", "trialing"]),
      head("subscriptions").eq("plan", "business").in("status", ["active", "trialing"]),
      head("ad_impressions").gte("created_at", today),
      head("ad_clicks").gte("created_at", today),
      head("ad_impressions").gte("created_at", week),
      head("ad_clicks").gte("created_at", week),
      head("affiliate_clicks").gte("created_at", today),
      head("affiliate_clicks").gte("created_at", week),
      head("api_usage").gte("created_at", today),
      head("api_usage").gte("created_at", week),
      head("api_keys").eq("revoked", false),
    ]);

    const pro = proCount.count ?? 0;
    const business = bizCount.count ?? 0;
    const i7 = impr7d.count ?? 0;
    const c7 = clicks7d.count ?? 0;

    return {
      currency: CURRENCY,
      mrr: Math.round((pro * PRICE_PRO + business * PRICE_BUSINESS) * 100) / 100,
      subscribers: { pro, business, total: pro + business },
      ads: {
        impressionsToday: imprToday.count ?? 0,
        clicksToday: clicksToday.count ?? 0,
        impr7d: i7,
        clicks7d: c7,
        ctr: i7 > 0 ? Math.round((c7 / i7) * 1000) / 10 : 0,
      },
      affiliate: { clicksToday: affToday.count ?? 0, clicks7d: aff7d.count ?? 0 },
      api: { callsToday: apiToday.count ?? 0, calls7d: api7d.count ?? 0, activeKeys: keys.count ?? 0 },
    };
  } catch {
    return null;
  }
}
