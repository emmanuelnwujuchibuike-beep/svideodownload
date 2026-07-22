import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import { eventDetail, eventLabel, NOTABLE } from "./activity-format";

/**
 * The admin live-activity reader — the thing behind "notify me on every event".
 *
 * It reads what the app ALREADY records: the unified `events` table (ad clicks,
 * subscribes, upgrade prompts, installs, …) and the `downloads` table, merged newest
 * first. This is honest about the architecture: events are logged, not pushed — so
 * the admin surface polls this on an interval rather than pretending there's a live
 * socket. Anonymous activity is included (a null actor renders as "Anonymous").
 *
 * NOT every raw event type is shown — `api_call` and `experiment_exposure` would
 * flood the feed. `NOTABLE` is the operator-meaningful set; widen it deliberately.
 */

export interface ActivityActor {
  handle: string;
  displayName: string;
}

export interface ActivityItem {
  id: string;
  kind: string;
  label: string;
  detail: string | null;
  /** Null = anonymous / no signed-in user. */
  actor: ActivityActor | null;
  at: string;
}

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

interface EventRow {
  id: string;
  user_id: string | null;
  type: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}
interface DownloadRow {
  id: string;
  user_id: string | null;
  platform: string | null;
  title: string | null;
  format: string | null;
  created_at: string;
}

/**
 * Recent notable activity, events + downloads merged newest-first. `since` (ISO)
 * returns only rows strictly newer — the incremental fetch the feed polls with.
 */
export async function fetchRecentActivity(limit = 40, since?: string): Promise<ActivityItem[]> {
  if (!hasSupabase) return [];
  try {
    const db = createAdminClient();
    let eventsQ = db
      .from("events")
      .select("id, user_id, type, metadata, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    let dlQ = db
      .from("downloads")
      .select("id, user_id, platform, title, format, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (since) {
      eventsQ = eventsQ.gt("created_at", since);
      dlQ = dlQ.gt("created_at", since);
    }
    const [{ data: events }, { data: downloads }] = await Promise.all([eventsQ, dlQ]);

    const eventItems: (ActivityItem & { userId: string | null })[] = ((events ?? []) as EventRow[])
      .filter((e) => NOTABLE.has(e.type))
      .map((e) => ({
        id: `e:${e.id}`,
        kind: e.type,
        label: eventLabel(e.type),
        detail: eventDetail(e.type, e.metadata),
        actor: null,
        userId: e.user_id,
        at: e.created_at,
      }));

    const downloadItems: (ActivityItem & { userId: string | null })[] = ((downloads ?? []) as DownloadRow[]).map(
      (d) => ({
        id: `d:${d.id}`,
        kind: "download",
        label: "Downloaded",
        detail: [d.platform, d.format].filter(Boolean).join(" · ") + (d.title ? ` — ${d.title}` : ""),
        actor: null,
        // A signed-in user's downloads carry their id (history sync writes it), so
        // they resolve to a handle below instead of all reading "Anonymous" — the
        // bug the operator reported. Guest downloads stay null → Anonymous.
        userId: d.user_id,
        at: d.created_at,
      }),
    );

    // Resolve actor handles for every item that has a user — events AND downloads.
    const userIds = [
      ...new Set(
        [...eventItems, ...downloadItems].map((i) => i.userId).filter(Boolean) as string[],
      ),
    ];
    const actorById = new Map<string, ActivityActor>();
    if (userIds.length > 0) {
      const { data: profs } = await db
        .from("profiles")
        .select("id, handle, display_name")
        .in("id", userIds);
      for (const p of (profs ?? []) as { id: string; handle: string | null; display_name: string | null }[]) {
        if (!p.handle) continue;
        actorById.set(p.id, { handle: p.handle, displayName: p.display_name || `@${p.handle}` });
      }
    }

    const merged = [...eventItems, ...downloadItems]
      .map(({ userId, ...item }) => ({
        ...item,
        actor: userId ? actorById.get(userId) ?? null : null,
      }))
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
      .slice(0, limit);

    return merged;
  } catch {
    return [];
  }
}

/** Real counts over rolling windows for one metric. */
export interface MetricTotals {
  day: number;
  week: number;
  month: number;
  year: number;
}

export interface ActivityTotals {
  downloads: MetricTotals;
  impressions: MetricTotals;
  adClicks: MetricTotals;
}

const DAY_MS = 86_400_000;

/**
 * Download / ad-impression / ad-click counts over the last 24h, 7d, 30d and 365d
 * — real, from the tables the app already writes (`downloads`, `ad_impressions`,
 * `ad_clicks`). Each cell is a Postgres `count`, so nothing is estimated. Returns
 * null when Supabase isn't configured or a query fails, so the UI can hide rather
 * than show zeros it can't stand behind.
 */
export async function fetchActivityTotals(): Promise<ActivityTotals | null> {
  if (!hasSupabase) return null;
  try {
    const db = createAdminClient();
    const now = Date.now();
    const since = (days: number) => new Date(now - days * DAY_MS).toISOString();
    const bounds = [1, 7, 30, 365].map(since) as [string, string, string, string];

    const count = (table: string, iso: string) =>
      db.from(table).select("*", { count: "exact", head: true }).gte("created_at", iso);

    // 3 metrics × 4 windows, all in flight at once.
    const metric = async (table: string): Promise<MetricTotals> => {
      const [d, w, m, y] = await Promise.all(bounds.map((iso) => count(table, iso)));
      return { day: d?.count ?? 0, week: w?.count ?? 0, month: m?.count ?? 0, year: y?.count ?? 0 };
    };

    const [downloads, impressions, adClicks] = await Promise.all([
      metric("downloads"),
      metric("ad_impressions"),
      metric("ad_clicks"),
    ]);

    return { downloads, impressions, adClicks };
  } catch {
    return null;
  }
}
