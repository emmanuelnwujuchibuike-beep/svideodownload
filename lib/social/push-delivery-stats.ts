import { createAdminClient } from "@/lib/supabase/admin";
import { paginatedSelect } from "@/lib/supabase/paginate";

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
  /**
   * Feature 20 / premium brief: notification VOLUME (every in-app row, pushed or not) in the
   * last 24 h, the busiest types, and what the Attention Engine decided. Counts only — never a
   * recipient, a message or anything a notification says.
   */
  notifications24h: number;
  notificationsCapped: boolean;
  topTypes: { type: string; count: number }[];
  decisions: { pushed: number; held: number; inApp: number; untracked: number };
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
  notifications24h: 0,
  notificationsCapped: false,
  topTypes: [],
  decisions: { pushed: 0, held: 0, inApp: 0, untracked: 0 },
};

/** Volume by type and delivery decision over 24 h — read when an admin opens the page, never on a timer. */
async function notificationVolume(db: ReturnType<typeof createAdminClient>, since: string): Promise<Pick<PushDeliveryStats, "notifications24h" | "notificationsCapped" | "topTypes" | "decisions">> {
  // with 0233's delivery column when it exists, without it before
  const run = (cols: string) => paginatedSelect<{ type: string; delivery?: string | null }>((from, to) => db.from("notifications").select(cols).gte("created_at", since).order("created_at", { ascending: false }).range(from, to) as never, 20_000);
  let res = await run("type, delivery");
  if (res.error && !res.rows.length) res = await run("type");
  const byType = new Map<string, number>();
  const decisions = { pushed: 0, held: 0, inApp: 0, untracked: 0 };
  for (const r of res.rows) {
    byType.set(r.type, (byType.get(r.type) ?? 0) + 1);
    if (r.delivery === "pushed") decisions.pushed += 1;
    else if (r.delivery === "held") decisions.held += 1;
    else if (r.delivery === "in_app") decisions.inApp += 1;
    else decisions.untracked += 1;
  }
  return {
    notifications24h: res.rows.length,
    notificationsCapped: res.capped,
    topTypes: [...byType.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([type, count]) => ({ type, count })),
    decisions,
  };
}

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
    const volume = await notificationVolume(db, oneDayAgo).catch(() => ({ notifications24h: 0, notificationsCapped: false, topTypes: [], decisions: EMPTY.decisions }));

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
      ...volume,
    };
  } catch {
    return EMPTY;
  }
}
