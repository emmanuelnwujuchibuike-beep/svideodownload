import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { paginatedSelect } from "@/lib/supabase/paginate";

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
  /**
   * Everything else the row carried, for the detail view.
   *
   * 🔴 Owner, 2026-08-31: "when i click on a live activity download or ad
   * impression, clicks, install, upgrade view, it doesnt show anything, it
   * should show all details and information of each".
   *
   * The feed was lossy by construction: it reduced every row to a one-line
   * `detail` string and discarded the rest, so there was nothing to open even
   * once the rows became clickable. An ad impression knows its zone, network
   * and placement; a download knows its platform, format and source URL — none
   * of that survived the mapping.
   *
   * Deliberately an open record rather than a typed union: this is an operator
   * diagnostic, and the useful thing is to show whatever the event ACTUALLY
   * logged, including keys added later by code that never touches this file.
   */
  meta: Record<string, unknown> | null;
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
  source_url: string | null;
}

/**
 * Collapse the SAME download's two `downloads` rows into one (owner,
 * 2026-08-16: "signed users who make download should show the user's name
 * and download details alone and not include a duplicate anonymous download
 * … it currently shows Frenz Download and also anonymous download with same
 * details").
 *
 * ── Why there are two rows for one download at all ──────────────────────────
 * `server/services/analytics.ts`'s `recordDownloadEvent` inserts an ANONYMOUS
 * row the instant `/api/download` is called — before the transfer has even
 * started, let alone finished, and with no `user_id` because that route
 * never resolves one (adding an auth round-trip to the hottest path in the
 * app to fix an admin-dashboard display bug would be the wrong trade). If the
 * visitor is signed in, `features/history/sync.ts`'s `pushAdd` inserts a
 * SECOND, fully-attributed row once the file actually finishes downloading
 * client-side — real completion, real `user_id`, real format/quality. Both
 * rows are honest individually; shown together they are the same event twice,
 * once unnamed.
 *
 * ── Why the fix is here and not upstream ────────────────────────────────────
 * Preventing the write is the alternative, and it's worse here: it would mean
 * either adding that auth lookup to `/api/download` (latency on every
 * download, including the guest ones this product exists to serve) or
 * skipping the platform-stats rollup for signed-in users until their download
 * finishes minutes later. Collapsing at READ time costs nothing on the
 * download path and only runs when an admin is actually looking at this feed.
 *
 * ── The matching rule ────────────────────────────────────────────────────────
 * Same `source_url`, one row with `user_id === null` and one with
 * `user_id !== null`, within a generous 20-minute window (large files —
 * Telegram in particular, see the note in server/services/telegram-mtproto.ts
 * — can take a while to actually finish). Paired 1:1 by nearest timestamp
 * within each `source_url` group, not "any anonymous row near any attributed
 * one", so two genuinely different people downloading the same viral link
 * around the same time are never merged into one. The ANONYMOUS row of each
 * matched pair is dropped; the attributed one — which also carries the real
 * format/quality, not just a media-kind guess — is kept.
 */
const DEDUPE_WINDOW_MS = 20 * 60_000;

function dedupeAttributedDownloads(rows: DownloadRow[]): DownloadRow[] {
  const bySource = new Map<string, DownloadRow[]>();
  for (const r of rows) {
    const key = r.source_url ?? `id:${r.id}`; // no source_url on file → never merge it
    const list = bySource.get(key);
    if (list) list.push(r);
    else bySource.set(key, [r]);
  }

  const drop = new Set<string>();
  for (const group of bySource.values()) {
    if (group.length < 2) continue;
    const anon = group.filter((r) => !r.user_id).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const attributed = group.filter((r) => r.user_id).sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (anon.length === 0 || attributed.length === 0) continue;

    const usedAttributed = new Set<string>();
    for (const a of anon) {
      const aTime = Date.parse(a.created_at);
      let best: DownloadRow | null = null;
      let bestDelta = Infinity;
      for (const u of attributed) {
        if (usedAttributed.has(u.id)) continue;
        const delta = Math.abs(Date.parse(u.created_at) - aTime);
        if (delta <= DEDUPE_WINDOW_MS && delta < bestDelta) {
          best = u;
          bestDelta = delta;
        }
      }
      if (best) {
        usedAttributed.add(best.id);
        drop.add(a.id);
      }
    }
  }

  return rows.filter((r) => !drop.has(r.id));
}

/**
 * Recent notable activity, events + downloads merged newest-first. `since` (ISO)
 * returns only rows strictly newer — the incremental fetch the feed polls with.
 */
/**
 * Unpack the `downloads.format` column into its real fields.
 *
 * 🔴 Owner, 2026-08-31: "add download status in the live activity details sheet
 * and all other detailed information".
 *
 * The status was never missing from the database — it was hiding in plain
 * sight. `features/history/sync.ts` PACKS six values into that one text column,
 * separated by `~|~`:
 *
 *     formatId ~|~ kind ~|~ qualityLabel ~|~ sizeBytes ~|~ status ~|~ reason
 *
 * so the feed was rendering `"best~|~video~|~1080p~|~5242880~|~failed~|~..."`
 * as an opaque blob, or slicing off just the first field. Splitting it here is
 * what turns "Download" into "a 1080p MP4 that FAILED, and why".
 *
 * ⚠️ The encoder is the source of truth for this layout. It lives in a
 * `"use client"` module, so the shape is duplicated rather than imported —
 * importing it would drag the browser Supabase client into a server path. If
 * the encoder ever gains a seventh field, this needs the same field.
 *
 * Trailing fields are optional: rows written before status/reason existed have
 * four segments, and an unsplittable value is returned as-is rather than
 * discarded — an operator would rather see a raw string than nothing.
 */
function decodePackedFormat(raw: string | null): Record<string, unknown> {
  if (!raw) return { format: null };
  const parts = raw.split("~|~");
  if (parts.length < 2) return { format: raw };
  const [formatId, kind, qualityLabel, sizeBytes, status, failureReason] = parts;
  const size = Number(sizeBytes);
  return {
    formatId: formatId || null,
    mediaKind: kind || null,
    quality: qualityLabel || null,
    // Bytes are unreadable at a glance; the operator wants "5.2 MB".
    size: Number.isFinite(size) && size > 0 ? formatBytes(size) : null,
    // The headline fact for this request. Older rows have no status field, and
    // `types/index.ts` defines a missing status as "completed".
    status: status || "completed",
    failureReason: failureReason || null,
  };
}

/** Bytes → a short human string. Local to avoid pulling a client util server-side. */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}

export async function fetchRecentActivity(limit = 40, since?: string): Promise<ActivityItem[]> {
  if (!hasSupabase) return [];
  try {
    const db = createAdminClient();

    /*
      🔴 A CATCH-UP fetch may return far more than a first page (owner,
      2026-08-10: the feed "doesn't update in real time and must not miss or
      skip any history").

      `limit` sizes the initial page — 40 rows is a sensible screenful. It is
      the wrong size for an incremental poll, because that one has to carry
      EVERYTHING that happened since the cursor, and a busy few seconds can
      produce more than forty. Anything past the limit was silently discarded
      and, because the cursor then advanced to the newest row returned, it was
      never fetched again. Gaps that could not be recovered from.
    */
    const take = since ? Math.max(limit, 500) : limit;

    let eventsQ = db
      .from("events")
      .select("id, user_id, type, metadata, created_at")
      /*
        🔴 Filter for notable types IN THE QUERY.

        This used to run as `.filter(e => NOTABLE.has(e.type))` in JavaScript,
        AFTER the database had already applied the limit. So the limit was
        spent on rows that were about to be thrown away: forty page-views in
        front of a subscription meant the subscription never arrived, and it
        never would, because the next poll's cursor had moved past it.

        The set is the same one; it is simply applied where the rows are
        selected rather than after they have been counted.
      */
      .in("type", [...NOTABLE])
      .order("created_at", { ascending: false })
      .limit(take);
    let dlQ = db
      .from("downloads")
      .select("id, user_id, platform, title, format, created_at, source_url")
      .order("created_at", { ascending: false })
      .limit(take);
    if (since) {
      // `gte`, not `gt`: a row sharing the cursor's exact timestamp must not be
      // dropped. The client dedups by id, so re-returning the cursor row itself is
      // harmless — but silently skipping a distinct same-millisecond row is not.
      eventsQ = eventsQ.gte("created_at", since);
      dlQ = dlQ.gte("created_at", since);
    }
    const [{ data: events }, { data: downloads }] = await Promise.all([eventsQ, dlQ]);

    const eventItems: (ActivityItem & { userId: string | null })[] = ((events ?? []) as EventRow[])
      /* Kept as a belt to the query's braces: a type that reaches here despite
         the `.in()` filter (a stale cached response, a future widening of the
         select) still cannot flood the feed. It no longer decides what is
         FETCHED, which was the bug. */
      .filter((e) => NOTABLE.has(e.type))
      .map((e) => ({
        id: `e:${e.id}`,
        kind: e.type,
        label: eventLabel(e.type),
        detail: eventDetail(e.type, e.metadata),
        actor: null,
        userId: e.user_id,
        at: e.created_at,
        // The raw logged payload, plus the identifiers an operator needs in
        // order to go and find this exact row in the database.
        meta: { eventId: e.id, eventType: e.type, ...(e.metadata ?? {}) },
      }));

    const downloadItems: (ActivityItem & { userId: string | null })[] = dedupeAttributedDownloads(
      (downloads ?? []) as DownloadRow[],
    ).map(
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
        meta: {
          downloadId: d.id,
          platform: d.platform,
          title: d.title,
          // Clickable in the detail sheet — the operator's "link so i can click
          // to open in the platform".
          sourceUrl: d.source_url,
          ...decodePackedFormat(d.format),
        },
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
  /**
   * Visitors active TODAY (UTC calendar day so far), split by whether their
   * very first event ever was before or after today started (owner,
   * 2026-08-16: "give a space that shows total number of retention users and
   * new users that day in live activity"). Null when the RPC from migration
   * 0115 isn't available — never rendered as zero, which would read as "no
   * visitors today" instead of "not measured".
   */
  visitorsToday: { newToday: number; returningToday: number } | null;
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

    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);
    const visitorSplit = async (): Promise<ActivityTotals["visitorsToday"]> => {
      try {
        const { data, error } = await db.rpc("analytics_visitor_split", { p_since: startOfToday.toISOString() });
        if (error) return null;
        const row = (data ?? [])[0] as { new_visitors: number; returning_visitors: number } | undefined;
        if (!row) return { newToday: 0, returningToday: 0 };
        return { newToday: Number(row.new_visitors) || 0, returningToday: Number(row.returning_visitors) || 0 };
      } catch {
        return null;
      }
    };

    const [downloads, impressions, adClicks, visitorsToday] = await Promise.all([
      metric("downloads"),
      metric("ad_impressions"),
      metric("ad_clicks"),
      visitorSplit(),
    ]);

    return { downloads, impressions, adClicks, visitorsToday };
  } catch {
    return null;
  }
}

export interface AnonymousDownloadCount {
  today: number;
  week: number;
}

const REPEAT_VISITOR_ROW_CAP = 20_000;

/**
 * Per-guest completed-download counts today/this rolling-7-days, keyed by the
 * FULL `visitor_id` (owner, 2026-08-16: "when an anonymous user download more
 * than once… show on the who as x2 or 3 or 4 or 5").
 *
 * 🔴 LIVE ACTIVITY DOES NOT READ THIS (owner, 2026-08-16: "remove the
 * anonymous amount of download in live activity and it should only be in
 * traffic section"). A "Repeat anonymous downloaders" list used to live on
 * the Activity tab, built from an earlier, independently-fetched version of
 * this same query — which meant the guest id it showed was never guaranteed
 * to be the same guest the Traffic tab's download-history table meant by the
 * same short id. That list is gone; the ONLY consumer now is
 * `lib/analytics/download-log.ts`, which looks up each download-history
 * row's count against this exact map by its own `visitor_id` — so the count
 * and the id next to it always describe the same guest, and there is exactly
 * one place in the admin dashboard this number is shown.
 */
export async function fetchAnonymousDownloadCounts(): Promise<Map<string, AnonymousDownloadCount>> {
  const counts = new Map<string, AnonymousDownloadCount>();
  if (!hasSupabase) return counts;
  try {
    const db = createAdminClient();
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setUTCHours(0, 0, 0, 0);
    // Rolling 7 days, same basis fetchActivityTotals' MetricTotals.week uses —
    // not a calendar week — so "this week" here means the same thing it means
    // everywhere else in this file.
    const startOfWeek = new Date(now.getTime() - 7 * 86_400_000);

    const { rows } = await paginatedSelect<{ visitor_id: string; created_at: string }>(
      (from, to) =>
        db
          .from("analytics_downloads")
          .select("visitor_id, created_at")
          .eq("status", "completed")
          .is("user_id", null)
          .gte("created_at", startOfWeek.toISOString())
          .range(from, to),
      REPEAT_VISITOR_ROW_CAP,
    );

    for (const r of rows) {
      if (!r.visitor_id) continue;
      const entry = counts.get(r.visitor_id) ?? { today: 0, week: 0 };
      entry.week += 1;
      if (r.created_at >= startOfToday.toISOString()) entry.today += 1;
      counts.set(r.visitor_id, entry);
    }
    return counts;
  } catch {
    return counts;
  }
}
