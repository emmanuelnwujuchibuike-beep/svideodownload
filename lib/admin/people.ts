import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { paginatedSelect } from "@/lib/supabase/paginate";

import { featureOf } from "@/lib/analytics/features";
import { eventLabel } from "./activity-format";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHO IS SIGNED IN, AND WHAT ARE THEY ACTUALLY DOING
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-27: "Make a place in admin dashboard where I can see all
 * signed in users and detailed activities."
 *
 * ── 🔴 THERE IS NO SESSION TABLE, AND THIS DOES NOT PRETEND OTHERWISE ───────
 *
 * Probed before building: `user_sessions`, `sessions`, `presence` and
 * `user_presence` all 404 — they do not exist. Supabase keeps real auth
 * sessions in `auth.sessions`, which PostgREST does not expose and which this
 * app has never read.
 *
 * So "signed in" here means something specific and honest: **a member whose
 * browser has recorded activity while carrying a session**, i.e. rows in
 * `analytics_events` with a non-null `user_id`. That is the same signal the
 * rest of the dashboard already counts as a signed-in visit.
 *
 * What it is NOT, and what the UI says out loud:
 *   • It is not "currently online". Someone who closed the tab still appears
 *     until their last activity falls out of the window.
 *   • It cannot see a member who signed in and did nothing.
 *   • It cannot see a member who opted out of analytics.
 *
 * A screen labelled "signed in users" that quietly meant "recently active" and
 * was read as "online right now" would be a fabricated stat with a login page
 * in front of it.
 *
 * ── Why this aggregates in TypeScript rather than in SQL ────────────────────
 *
 * Measured first: 4,576 signed-in events over seven days, across ~40 distinct
 * members, against 146 profiles in total. At that size a paged read and a Map
 * is cheaper end to end than a new `security definer` RPC, a migration and a
 * grant — and it ships now rather than behind a migration runner that is
 * currently lagging.
 *
 * ⚠️ IF THIS EVER OUTGROWS THE WINDOW the honest move is an RPC, not a bigger
 * cap. `paginatedSelect` reports `capped`, and the UI surfaces it, so the day
 * the read stops being complete the screen says so instead of quietly showing
 * the oldest slice — the exact failure the 1000-row ceiling caused before.
 */

/** How far back the roster looks, and the ceiling on rows it will page through. */
const DEFAULT_WINDOW_HOURS = 24;
const MAX_WINDOW_HOURS = 24 * 30;
/**
 * A hard stop, well above the measured 30-day volume (17,847 rows). It exists
 * so a traffic spike degrades into a labelled partial read rather than an
 * unbounded one.
 */
const ROW_CAP = 40_000;
/** Events shown on one member's timeline. */
const TIMELINE_LIMIT = 200;

export interface SignedInUser {
  userId: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
  isSuspended: boolean;
  isHidden: boolean;
  /** ISO. The most recent thing we saw them do. */
  lastSeen: string;
  /** ISO. The earliest activity inside the window — not their sign-up date. */
  firstSeenInWindow: string;
  events: number;
  sessions: number;
  pageViews: number;
  downloads: number;
  /** Where they were last, so an operator can open the same screen. */
  lastPath: string | null;
  device: string | null;
  browser: string | null;
  os: string | null;
  country: string | null;
  city: string | null;
  /** Which parts of the product they touched, busiest first. */
  features: { feature: string; count: number }[];
}

export interface MemberActivityItem {
  eventId: string;
  type: string;
  label: string;
  feature: string | null;
  at: string;
  path: string | null;
  sessionId: string;
  device: string | null;
  browser: string | null;
  country: string | null;
  properties: Record<string, unknown> | null;
}

export interface SignedInRoster {
  users: SignedInUser[];
  windowHours: number;
  /** Total member accounts, for "12 of 146 active" rather than a bare 12. */
  totalMembers: number;
  /**
   * True when the read hit `ROW_CAP` or a page failed. The UI must say so —
   * a partial aggregate that looks complete is worse than no aggregate.
   */
  partial: boolean;
}

interface EventRow {
  event_id: string;
  user_id: string | null;
  session_id: string;
  event_type: string;
  received_at: string;
  path: string | null;
  device: string | null;
  browser: string | null;
  os: string | null;
  country: string | null;
  city: string | null;
  feature: string | null;
  properties: Record<string, unknown> | null;
}

interface ProfileRow {
  id: string;
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
  is_admin: boolean | null;
  role: string | null;
  is_suspended: boolean | null;
  is_hidden: boolean | null;
}

const SELECT =
  "event_id,user_id,session_id,event_type,received_at,path,device,browser,os,country,city,feature,properties";

function clampWindow(hours: number | undefined): number {
  if (!Number.isFinite(hours) || !hours || hours <= 0) return DEFAULT_WINDOW_HOURS;
  return Math.min(Math.round(hours), MAX_WINDOW_HOURS);
}

/**
 * The roster: every member seen active inside the window, busiest-last-seen
 * first.
 *
 * Bots are excluded (`is_bot = false`), the same filter every other aggregate
 * on this table uses — a signed-in member is never a bot, but a mis-parsed
 * user agent can mark one, and including them here would put a real person in
 * the list twice with contradictory device columns.
 */
export async function fetchSignedInUsers(windowHours?: number): Promise<SignedInRoster> {
  const hours = clampWindow(windowHours);
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();
  const db = createAdminClient();

  const { rows, capped, error } = await paginatedSelect<EventRow>(
    (from, to) =>
      db
        .from("analytics_events")
        .select(SELECT)
        .not("user_id", "is", null)
        .eq("is_bot", false)
        .gte("received_at", since)
        .order("received_at", { ascending: false })
        .range(from, to),
    ROW_CAP,
  );

  const byUser = new Map<
    string,
    {
      events: EventRow[];
      sessions: Set<string>;
      pageViews: number;
      downloads: number;
      features: Map<string, number>;
    }
  >();

  for (const r of rows) {
    if (!r.user_id) continue;
    let e = byUser.get(r.user_id);
    if (!e) {
      e = { events: [], sessions: new Set(), pageViews: 0, downloads: 0, features: new Map() };
      byUser.set(r.user_id, e);
    }
    e.events.push(r);
    e.sessions.add(r.session_id);
    if (r.event_type === "page_view") e.pageViews++;
    /*
      One download is counted ONCE, at the moment it is requested. The lifecycle
      emits requested → started → preparing → completed, so counting every
      download_* event would report four downloads for one file — the kind of
      number an operator would reasonably act on and be wrong.
    */
    if (r.event_type === "download_requested") e.downloads++;
    /*
      `feature` is null on every row written before migration 0172, so it is
      derived from the event name when absent rather than left blank. The
      classifier is the same one the ingest uses, so an old row and a new row
      land in the same bucket instead of the history appearing to start today.
    */
    const feature = r.feature ?? featureOf(r.event_type);
    if (feature) e.features.set(feature, (e.features.get(feature) ?? 0) + 1);
  }

  const ids = [...byUser.keys()];
  const profiles = new Map<string, ProfileRow>();
  if (ids.length > 0) {
    const { data } = await db
      .from("profiles")
      .select("id,handle,display_name,avatar_url,is_admin,role,is_suspended,is_hidden")
      .in("id", ids);
    for (const p of (data ?? []) as ProfileRow[]) profiles.set(p.id, p);
  }

  const { count: totalMembers } = await db
    .from("profiles")
    .select("id", { count: "exact", head: true });

  const users: SignedInUser[] = ids.map((id) => {
    const e = byUser.get(id)!;
    // Rows arrive newest-first, so the first is the latest and the last the earliest.
    const latest = e.events[0]!;
    const earliest = e.events[e.events.length - 1]!;
    const p = profiles.get(id);
    /*
      The last row that actually carried a path. `page_exit` and most product
      events carry one, but a download beacon may not, and showing "—" for
      somebody who is demonstrably on a page reads as a bug.
    */
    const lastWithPath = e.events.find((r) => r.path);
    const lastWithDevice = e.events.find((r) => r.device);
    const lastWithGeo = e.events.find((r) => r.country);
    return {
      userId: id,
      handle: p?.handle ?? null,
      displayName: p?.display_name ?? null,
      avatarUrl: p?.avatar_url ?? null,
      // Either signal means admin — 0144 kept `role` working alongside the flag.
      isAdmin: !!p?.is_admin || p?.role === "admin",
      isSuspended: !!p?.is_suspended,
      isHidden: !!p?.is_hidden,
      lastSeen: latest.received_at,
      firstSeenInWindow: earliest.received_at,
      events: e.events.length,
      sessions: e.sessions.size,
      pageViews: e.pageViews,
      downloads: e.downloads,
      lastPath: lastWithPath?.path ?? null,
      device: lastWithDevice?.device ?? null,
      browser: lastWithDevice?.browser ?? null,
      os: lastWithDevice?.os ?? null,
      country: lastWithGeo?.country ?? null,
      city: lastWithGeo?.city ?? null,
      features: [...e.features.entries()]
        .map(([feature, count]) => ({ feature, count }))
        .sort((a, b) => b.count - a.count),
    };
  });

  users.sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : a.lastSeen > b.lastSeen ? -1 : 0));

  return {
    users,
    windowHours: hours,
    totalMembers: totalMembers ?? 0,
    // A failed page counts as partial too: rows from before the failure are
    // still returned, and `rows.length` alone cannot tell that apart from a
    // genuinely small result.
    partial: capped || !!error,
  };
}

/**
 * One member's detailed activity, newest first.
 *
 * Deliberately the RAW events rather than a summary: the owner asked for
 * "detailed activities", and the whole reason the live feed was rebuilt in
 * August was that reducing each row to a one-line string threw away everything
 * an operator opens a row to find out.
 */
export async function fetchMemberActivity(
  userId: string,
  windowHours?: number,
): Promise<{ items: MemberActivityItem[]; windowHours: number }> {
  const hours = clampWindow(windowHours);
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();
  const db = createAdminClient();

  const { data } = await db
    .from("analytics_events")
    .select(SELECT)
    .eq("user_id", userId)
    .gte("received_at", since)
    .order("received_at", { ascending: false })
    .limit(TIMELINE_LIMIT);

  const items = ((data ?? []) as EventRow[]).map((r) => ({
    eventId: r.event_id,
    type: r.event_type,
    // The same labels the live activity feed uses, so one event never reads as
    // two different things in two places.
    label: eventLabel(r.event_type),
    feature: r.feature ?? featureOf(r.event_type),
    at: r.received_at,
    path: r.path,
    sessionId: r.session_id,
    device: r.device,
    browser: r.browser,
    country: r.country,
    properties: r.properties && Object.keys(r.properties).length > 0 ? r.properties : null,
  }));

  return { items, windowHours: hours };
}
