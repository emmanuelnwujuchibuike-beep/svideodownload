import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Real, computed push-delivery health for the admin dashboard — genuine
 * queries against `push_delivery_log`/`push_subscriptions`, mirroring
 * messaging-stats.ts's identical reasoning (a handful of parallel COUNT
 * queries is the honest, right-sized version of "monitoring" at this app's
 * real scale, not a separate metrics pipeline).
 */
export interface PushDeliveryStats {
  activeSubscriptions: number;
  sent24h: number;
  sent7d: number;
  retried7d: number;
  failed7d: number;
  pruned7d: number;
  failureRate7d: number;
  topErrors: { error: string; count: number }[];
}

const EMPTY: PushDeliveryStats = {
  activeSubscriptions: 0,
  sent24h: 0,
  sent7d: 0,
  retried7d: 0,
  failed7d: 0,
  pruned7d: 0,
  failureRate7d: 0,
  topErrors: [],
};

export async function fetchPushDeliveryStats(): Promise<PushDeliveryStats> {
  const hasSupabase = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!hasSupabase) return EMPTY;

  try {
    const db = createAdminClient();
    const now = Date.now();
    const oneDayAgo = new Date(now - 24 * 60 * 60_000).toISOString();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60_000).toISOString();

    const [
      { count: activeSubscriptions },
      { count: sent24h },
      { count: sent7dSent },
      { count: sent7dRetried },
      { count: failed7d },
      { count: pruned7d },
      { data: errorRows },
    ] = await Promise.all([
      db.from("push_subscriptions").select("id", { head: true, count: "exact" }),
      db.from("push_delivery_log").select("id", { head: true, count: "exact" }).in("status", ["sent", "retried"]).gte("created_at", oneDayAgo),
      db.from("push_delivery_log").select("id", { head: true, count: "exact" }).eq("status", "sent").gte("created_at", sevenDaysAgo),
      db.from("push_delivery_log").select("id", { head: true, count: "exact" }).eq("status", "retried").gte("created_at", sevenDaysAgo),
      db.from("push_delivery_log").select("id", { head: true, count: "exact" }).eq("status", "failed").gte("created_at", sevenDaysAgo),
      db.from("push_delivery_log").select("id", { head: true, count: "exact" }).eq("status", "pruned").gte("created_at", sevenDaysAgo),
      db.from("push_delivery_log").select("error").eq("status", "failed").gte("created_at", sevenDaysAgo).not("error", "is", null).limit(2_000),
    ]);

    const errorCounts = new Map<string, number>();
    for (const r of (errorRows ?? []) as { error: string | null }[]) {
      const key = r.error ?? "unknown";
      errorCounts.set(key, (errorCounts.get(key) ?? 0) + 1);
    }
    const topErrors = [...errorCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([error, count]) => ({ error, count }));

    const sent7d = (sent7dSent ?? 0) + (sent7dRetried ?? 0);
    const f7 = failed7d ?? 0;
    const totalAttempts7d = sent7d + f7;
    const failureRate7d = totalAttempts7d > 0 ? Math.round((f7 / totalAttempts7d) * 1000) / 10 : 0;

    return {
      activeSubscriptions: activeSubscriptions ?? 0,
      sent24h: sent24h ?? 0,
      sent7d,
      retried7d: sent7dRetried ?? 0,
      failed7d: f7,
      pruned7d: pruned7d ?? 0,
      failureRate7d,
      topErrors,
    };
  } catch {
    return EMPTY;
  }
}
