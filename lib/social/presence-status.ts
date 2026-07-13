import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Manual presence status (Away/Busy/Do Not Disturb/Invisible — "available"
 * is the unset default, distinct from actual connectivity). Deliberately a
 * separate table with no cross-user RLS read policy (see migration 0043's
 * own comment) — all cross-user reads go through `getDisplayedStatuses`
 * below, which is the ONE place the "invisible" privacy transform is
 * applied, so it can never leak via a different code path later.
 *
 * "Invisible" specifically also means the client should never `track()`
 * itself on the shared online-presence channel at all (see
 * features/friends/use-presence.ts) — true invisibility requires never
 * appearing online in the first place, not just hiding a status label.
 */
export type PresenceStatus = "available" | "away" | "busy" | "dnd" | "invisible";

const VALID: ReadonlySet<string> = new Set<PresenceStatus>(["available", "away", "busy", "dnd", "invisible"]);
export function isPresenceStatus(v: string): v is PresenceStatus {
  return VALID.has(v);
}

export async function setPresenceStatus(userId: string, status: PresenceStatus): Promise<{ ok: boolean }> {
  try {
    const db = createAdminClient();
    const { error } = await db
      .from("user_presence_status")
      .upsert({ user_id: userId, status, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}

/** Your OWN true status, never transformed — for your own status picker UI. */
export async function getOwnPresenceStatus(userId: string): Promise<PresenceStatus> {
  try {
    const db = createAdminClient();
    const { data } = await db.from("user_presence_status").select("status").eq("user_id", userId).maybeSingle();
    const s = data?.status as string | undefined;
    return s && isPresenceStatus(s) ? s : "available";
  } catch {
    return "available";
  }
}

export interface DisplayedPresence {
  status: PresenceStatus;
  /** Last time this row was touched (a status change, or the heartbeat
   * `use-presence.ts` fires on every successful presence-channel connect) —
   * shown as "last seen" for a target who isn't currently online. Same
   * privacy transform as `status` itself: never populated for an invisible
   * target, so it can't leak through a different code path than the one
   * `usePresence()`'s online set already goes through. */
  lastActiveAt: string | null;
}

/**
 * What OTHER users are allowed to see. An "invisible" target is simply
 * OMITTED from the result (not mapped to a fake value) — the calling UI's
 * default-when-absent behavior ("no special status") is exactly what
 * invisible is supposed to look like from the outside, and combined with
 * the client never tracking presence when invisible (see the module
 * comment), they read as a perfectly ordinary never-customized user.
 *
 * Part 11b: ALSO checks each target's `last_seen_visibility` privacy
 * setting (migration 0060) — 'everyone' (default) is unchanged from
 * before; 'friends' requires a `friendships` row with the viewer;
 * 'nobody' omits the target the same way 'invisible' does. Before this,
 * ANY signed-in user could query ANY other user's online/last-seen status
 * with zero relationship gating at all — a real, previously-unfixed gap.
 */
export async function getDisplayedStatuses(viewerId: string, targetUserIds: string[]): Promise<Map<string, DisplayedPresence>> {
  const out = new Map<string, DisplayedPresence>();
  const ids = [...new Set(targetUserIds)].filter((id) => id !== viewerId);
  const includeSelf = targetUserIds.includes(viewerId);
  if (ids.length === 0 && !includeSelf) return out;
  try {
    const db = createAdminClient();
    const allIds = includeSelf ? [...ids, viewerId] : ids;
    const [{ data: statusRows }, { data: privRows }, { data: friendRows }] = await Promise.all([
      db.from("user_presence_status").select("user_id, status, updated_at").in("user_id", allIds),
      ids.length
        ? db.from("privacy_settings").select("user_id, last_seen_visibility").in("user_id", ids)
        : Promise.resolve({ data: [] as { user_id: string; last_seen_visibility: string }[] }),
      // All of the VIEWER's friendship rows — cheaper and simpler than a
      // per-target OR clause, and the viewer's own friend count is small.
      db.from("friendships").select("user_low, user_high").or(`user_low.eq.${viewerId},user_high.eq.${viewerId}`),
    ]);

    const visibilityById = new Map(
      ((privRows ?? []) as { user_id: string; last_seen_visibility: string }[]).map((p) => [p.user_id, p.last_seen_visibility]),
    );
    const friendIds = new Set<string>();
    for (const f of (friendRows ?? []) as { user_low: string; user_high: string }[]) {
      friendIds.add(f.user_low === viewerId ? f.user_high : f.user_low);
    }

    for (const row of (statusRows ?? []) as { user_id: string; status: string; updated_at: string }[]) {
      if (!isPresenceStatus(row.status)) continue;
      const isSelf = row.user_id === viewerId;
      if (row.status === "invisible" && !isSelf) continue;
      if (!isSelf) {
        const visibility = visibilityById.get(row.user_id) ?? "everyone";
        if (visibility === "nobody") continue;
        if (visibility === "friends" && !friendIds.has(row.user_id)) continue;
      }
      out.set(row.user_id, { status: row.status, lastActiveAt: row.updated_at });
    }
  } catch {
    /* best-effort; a missing entry just means "available" (the default) at the call site */
  }
  return out;
}
