import { createAdminClient } from "@/lib/supabase/admin";

import { paginatedSelect } from "../supabase/paginate";
import {
  DEFAULT_CREATOR_NOTIFICATION_PREFS,
  isAllDefaultPrefs,
  type CreatorNotificationChannel,
  type CreatorNotificationPrefs,
} from "./creator-notification-channels";

/* Re-exported so a server caller still has one import for the whole feature.
   The definitions live in the client-safe sibling — see its own note. */
export {
  CREATOR_NOTIFICATION_CHANNELS,
  CREATOR_NOTIFICATION_LABELS,
  DEFAULT_CREATOR_NOTIFICATION_PREFS,
} from "./creator-notification-channels";
export type { CreatorNotificationChannel, CreatorNotificationPrefs } from "./creator-notification-channels";

/**
 * Per-creator notification preferences.
 *
 * Owner, 2026-08-23: "make users to be able to turn on and off another users
 * post notification, stories notification, feed or share notification."
 *
 * See migration 0129 for the storage model and for why each channel defaults
 * the way it does. The short version: `posts`/`stories`/`feed` are opt-IN, so
 * this feature changes nothing for anyone until they ask for it; `shares`
 * defaults on because that notification already fires and the new capability
 * is switching it off.
 */

function rowToPrefs(row: Partial<CreatorNotificationPrefs> | null | undefined): CreatorNotificationPrefs {
  if (!row) return { ...DEFAULT_CREATOR_NOTIFICATION_PREFS };
  return {
    posts: row.posts ?? DEFAULT_CREATOR_NOTIFICATION_PREFS.posts,
    stories: row.stories ?? DEFAULT_CREATOR_NOTIFICATION_PREFS.stories,
    feed: row.feed ?? DEFAULT_CREATOR_NOTIFICATION_PREFS.feed,
    shares: row.shares ?? DEFAULT_CREATOR_NOTIFICATION_PREFS.shares,
  };
}

/** What `viewer` currently receives about `target`. Never throws. */
export async function getCreatorNotificationPrefs(
  viewerId: string,
  targetId: string,
): Promise<CreatorNotificationPrefs> {
  if (viewerId === targetId) return { ...DEFAULT_CREATOR_NOTIFICATION_PREFS };
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("creator_notification_prefs")
      .select("posts, stories, feed, shares")
      .eq("viewer_id", viewerId)
      .eq("target_id", targetId)
      .maybeSingle();
    return rowToPrefs(data as Partial<CreatorNotificationPrefs> | null);
  } catch {
    // Migration 0129 not applied, or the table is unreachable. Defaults are the
    // safe answer: they are exactly today's behaviour.
    return { ...DEFAULT_CREATOR_NOTIFICATION_PREFS };
  }
}

/**
 * Apply a partial change and return the resulting state.
 *
 * Writes are upserts on the composite primary key, EXCEPT when the result is
 * all-defaults — then the row is deleted instead. Keeping the table to
 * deliberate choices only is what lets `getCreatorNotificationPrefs` treat a
 * missing row as "never expressed an opinion", and stops a table with one row
 * per (follower × creator) pair growing without bound as people toggle things
 * on and back off.
 */
export async function setCreatorNotificationPrefs(
  viewerId: string,
  targetId: string,
  patch: Partial<CreatorNotificationPrefs>,
): Promise<{ ok: boolean; prefs: CreatorNotificationPrefs }> {
  const current = await getCreatorNotificationPrefs(viewerId, targetId);
  if (viewerId === targetId) return { ok: false, prefs: current };

  const next: CreatorNotificationPrefs = { ...current, ...patch };
  try {
    const db = createAdminClient();
    if (isAllDefaultPrefs(next)) {
      await db
        .from("creator_notification_prefs")
        .delete()
        .eq("viewer_id", viewerId)
        .eq("target_id", targetId);
      return { ok: true, prefs: next };
    }
    const { error } = await db
      .from("creator_notification_prefs")
      .upsert(
        { viewer_id: viewerId, target_id: targetId, ...next, updated_at: new Date().toISOString() },
        // The composite PRIMARY KEY is a real unique constraint, so ON CONFLICT
        // can infer it by column list — unlike the partial unique indexes that
        // made `upsert` fail with 42P10 on app_ratings (2026-08-23). Named
        // explicitly rather than relying on inference from the payload.
        { onConflict: "viewer_id,target_id" },
      );
    if (error) return { ok: false, prefs: current };
    return { ok: true, prefs: next };
  } catch {
    return { ok: false, prefs: current };
  }
}

/**
 * Everyone who asked to be notified about `targetId`'s activity on `channel`.
 *
 * The emission-side query. Runs through the service role so one person's
 * preferences are never exposed to another (RLS restricts SELECT to your own
 * rows — see migration 0129).
 *
 * 🔴 Paginated. PostgREST silently truncates at 1000 rows, so a creator whose
 * 1001st follower enabled notifications would simply never hear from them,
 * with nothing anywhere reporting a problem — the failure mode documented in
 * [[postgrest-1000-row-silent-truncation-2026-08-16]]. Capped all the same, so
 * one very popular account cannot turn a single publish into an unbounded fan-
 * out; the cap is high enough that hitting it is a scale problem worth knowing
 * about rather than a routine trim.
 */
const SUBSCRIBER_CAP = 20_000;

export async function subscribersFor(
  targetId: string,
  channel: CreatorNotificationChannel,
): Promise<string[]> {
  try {
    const db = createAdminClient();
    const { rows } = await paginatedSelect<{ viewer_id: string }>(
      (from, to) =>
        db
          .from("creator_notification_prefs")
          .select("viewer_id")
          .eq("target_id", targetId)
          .eq(channel, true)
          .range(from, to),
      SUBSCRIBER_CAP,
    );
    return rows.map((r) => r.viewer_id);
  } catch {
    return [];
  }
}

/**
 * Whether `viewerId` still wants `channel` notifications about `targetId`.
 *
 * For the channels that default ON (`shares`), this is the check an EXISTING
 * notification path makes before sending — the opt-out. Defaults are returned
 * on any failure, so a missing migration or an unreachable table can never
 * suppress a notification that would otherwise have been sent.
 */
export async function wantsCreatorNotification(
  viewerId: string,
  targetId: string,
  channel: CreatorNotificationChannel,
): Promise<boolean> {
  if (viewerId === targetId) return false;
  const prefs = await getCreatorNotificationPrefs(viewerId, targetId);
  return prefs[channel];
}
