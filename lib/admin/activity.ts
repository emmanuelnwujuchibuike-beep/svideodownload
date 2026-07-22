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
      .select("id, platform, title, format, created_at")
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
        userId: null,
        at: d.created_at,
      }),
    );

    // Resolve actor handles for the events that have a user.
    const userIds = [...new Set(eventItems.map((i) => i.userId).filter(Boolean) as string[])];
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
