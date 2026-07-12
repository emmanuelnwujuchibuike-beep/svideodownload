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
 */
export async function getDisplayedStatuses(viewerId: string, targetUserIds: string[]): Promise<Map<string, DisplayedPresence>> {
  const out = new Map<string, DisplayedPresence>();
  const ids = [...new Set(targetUserIds)];
  if (ids.length === 0) return out;
  try {
    const db = createAdminClient();
    const { data } = await db.from("user_presence_status").select("user_id, status, updated_at").in("user_id", ids);
    for (const row of (data ?? []) as { user_id: string; status: string; updated_at: string }[]) {
      if (!isPresenceStatus(row.status)) continue;
      if (row.status === "invisible" && row.user_id !== viewerId) continue;
      out.set(row.user_id, { status: row.status, lastActiveAt: row.updated_at });
    }
  } catch {
    /* best-effort; a missing entry just means "available" (the default) at the call site */
  }
  return out;
}
