import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Admin analytics reads over the Phase-1 tables. Totals use accurate COUNT filters;
 * breakdowns + unique/live visitor tallies use a capped recent sample aggregated in
 * JS (exact grouped/distinct aggregates at very high volume are a later phase via a
 * SQL RPC). Degrades to zeros before migration 0103 is applied.
 */
export type Range = "24h" | "7d" | "30d";

export interface Breakdown {
  key: string;
  count: number;
}

export interface AnalyticsSummary {
  range: Range;
  liveVisitors: number;
  uniqueVisitors: number;
  sessions: number;
  pageViews: number;
  totalEvents: number;
  downloads: { total: number; completed: number; failed: number; successRate: number };
  topPlatforms: Breakdown[];
  byDevice: Breakdown[];
  byBrowser: Breakdown[];
  byCountry: Breakdown[];
  approxBreakdowns: boolean;
  generatedAt: string;
}

const SAMPLE_CAP = 20_000;

function sinceIso(range: Range): string {
  const days = range === "24h" ? 1 : range === "7d" ? 7 : 30;
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export async function getAnalyticsSummary(range: Range): Promise<AnalyticsSummary> {
  const empty: AnalyticsSummary = {
    range,
    liveVisitors: 0,
    uniqueVisitors: 0,
    sessions: 0,
    pageViews: 0,
    totalEvents: 0,
    downloads: { total: 0, completed: 0, failed: 0, successRate: 0 },
    topPlatforms: [],
    byDevice: [],
    byBrowser: [],
    byCountry: [],
    approxBreakdowns: false,
    generatedAt: new Date().toISOString(),
  };

  try {
    const db = createAdminClient();
    const since = sinceIso(range);
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();

    const countOf = async (build: PromiseLike<{ count: number | null }>): Promise<number> => {
      const { count } = await build;
      return count ?? 0;
    };

    const [totalEvents, pageViews, sessions, dlTotal, dlCompleted, dlFailed] = await Promise.all([
      countOf(db.from("analytics_events").select("event_id", { head: true, count: "exact" }).gte("received_at", since)),
      countOf(db.from("analytics_events").select("event_id", { head: true, count: "exact" }).eq("event_type", "page_view").gte("received_at", since)),
      countOf(db.from("analytics_events").select("event_id", { head: true, count: "exact" }).eq("event_type", "session_start").gte("received_at", since)),
      countOf(db.from("analytics_downloads").select("download_id", { head: true, count: "exact" }).gte("created_at", since)),
      countOf(db.from("analytics_downloads").select("download_id", { head: true, count: "exact" }).eq("status", "completed").gte("created_at", since)),
      countOf(db.from("analytics_downloads").select("download_id", { head: true, count: "exact" }).eq("status", "failed").gte("created_at", since)),
    ]);

    // Sample recent events for the visitor tallies + breakdowns.
    const { data: sample } = await db
      .from("analytics_events")
      .select("visitor_id, device, browser, country, received_at")
      .gte("received_at", since)
      .order("received_at", { ascending: false })
      .limit(SAMPLE_CAP);
    const rows = (sample ?? []) as { visitor_id: string; device: string | null; browser: string | null; country: string | null; received_at: string }[];

    const uniq = new Set<string>();
    const live = new Set<string>();
    for (const r of rows) {
      uniq.add(r.visitor_id);
      if (r.received_at >= fiveMinAgo) live.add(r.visitor_id);
    }
    const tally = (get: (r: (typeof rows)[number]) => string | null): Breakdown[] => {
      const m = new Map<string, number>();
      for (const r of rows) {
        const k = get(r) || "Unknown";
        m.set(k, (m.get(k) ?? 0) + 1);
      }
      return [...m.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count).slice(0, 8);
    };

    const { data: dlSample } = await db.from("analytics_downloads").select("platform").gte("created_at", since).limit(SAMPLE_CAP);
    const pm = new Map<string, number>();
    for (const r of (dlSample ?? []) as { platform: string | null }[]) {
      const p = r.platform || "unknown";
      pm.set(p, (pm.get(p) ?? 0) + 1);
    }
    const topPlatforms = [...pm.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count).slice(0, 10);

    return {
      range,
      liveVisitors: live.size,
      uniqueVisitors: uniq.size,
      sessions,
      pageViews,
      totalEvents,
      downloads: { total: dlTotal, completed: dlCompleted, failed: dlFailed, successRate: dlTotal ? Math.round((dlCompleted / dlTotal) * 100) : 0 },
      topPlatforms,
      byDevice: tally((r) => r.device),
      byBrowser: tally((r) => r.browser),
      byCountry: tally((r) => r.country),
      approxBreakdowns: rows.length >= SAMPLE_CAP,
      generatedAt: new Date().toISOString(),
    };
  } catch {
    return empty; // tables not migrated yet, or a transient error
  }
}
