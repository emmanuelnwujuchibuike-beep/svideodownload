import { audienceAllows, effectivePresence, isFocusMode, presenceLine, type OpenTo, type PresenceRow, type PresenceSchedule } from "@/lib/social/presence/engine";
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
  /**
   * Feature 19 Part 9 (0224): what the target says about themselves - the
   * focus or custom status line, the auto reply, what they are open to. Gated
   * by THEIR status audience (everyone / friends / one circle / nobody),
   * independently of last seen. null = not allowed, or nothing set.
   */
  details: { line: string | null; autoReply: string | null; openTo: OpenTo[] } | null;
}

type StatusRow = { user_id: string; status: string; updated_at: string; custom_text?: string | null; custom_until?: string | null; focus_mode?: string | null; focus_until?: string | null; auto_reply?: string | null; open_to?: string[] | null; audience?: string | null; audience_circle?: string | null };
type ScheduleRow = { id: string; owner_id: string; mode: string; days: number; start_min: number; end_min: number; tz: string; enabled: boolean };

export function toSchedule(r: ScheduleRow): PresenceSchedule | null {
  if (!isFocusMode(r.mode)) return null;
  return { id: r.id, mode: r.mode, days: r.days, startMin: r.start_min, endMin: r.end_min, tz: r.tz, enabled: r.enabled };
}

export function toPresenceRow(r: StatusRow): PresenceRow {
  return {
    status: isPresenceStatus(r.status) ? r.status : "available",
    customText: r.custom_text ?? null,
    customUntil: r.custom_until ?? null,
    focusMode: r.focus_mode ?? null,
    focusUntil: r.focus_until ?? null,
    autoReply: r.auto_reply ?? null,
    openTo: r.open_to ?? [],
    audience: r.audience ?? "everyone",
  };
}

const FULL_COLUMNS = "user_id, status, updated_at, custom_text, custom_until, focus_mode, focus_until, auto_reply, open_to, audience, audience_circle";

/** The status rows, with the 0224 columns when they exist (the code runs before and after the migration). */
async function statusRowsFor(db: ReturnType<typeof createAdminClient>, ids: string[]): Promise<{ rows: StatusRow[]; full: boolean }> {
  const full = await db.from("user_presence_status").select(FULL_COLUMNS).in("user_id", ids);
  if (!full.error) return { rows: (full.data ?? []) as StatusRow[], full: true };
  const base = await db.from("user_presence_status").select("user_id, status, updated_at").in("user_id", ids);
  return { rows: (base.data ?? []) as StatusRow[], full: false };
}

export async function schedulesFor(db: ReturnType<typeof createAdminClient>, ids: string[]): Promise<Map<string, PresenceSchedule[]>> {
  const out = new Map<string, PresenceSchedule[]>();
  if (!ids.length) return out;
  const { data, error } = await db.from("presence_schedules").select("id, owner_id, mode, days, start_min, end_min, tz, enabled").in("owner_id", ids).eq("enabled", true);
  if (error) return out;
  for (const r of (data ?? []) as ScheduleRow[]) {
    const s = toSchedule(r);
    if (s) out.set(r.owner_id, [...(out.get(r.owner_id) ?? []), s]);
  }
  return out;
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
    const [{ rows: statusRows, full }, { data: privRows }, { data: friendRows }] = await Promise.all([
      statusRowsFor(db, allIds),
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

    // Part 9: the circle audience is the TARGET's own circle - is the viewer in it?
    const circleIds = [...new Set(statusRows.filter((r) => r.audience === "circle" && r.audience_circle).map((r) => r.audience_circle!))];
    const [inCircles, schedules] = await Promise.all([
      circleIds.length
        ? db.from("circle_members").select("circle_id").in("circle_id", circleIds).eq("member_id", viewerId).then(({ data }) => new Set(((data ?? []) as { circle_id: string }[]).map((c) => c.circle_id)))
        : Promise.resolve(new Set<string>()),
      full ? schedulesFor(db, allIds) : Promise.resolve(new Map<string, PresenceSchedule[]>()),
    ]);
    const now = new Date();

    for (const row of statusRows) {
      if (!isPresenceStatus(row.status)) continue;
      const isSelf = row.user_id === viewerId;
      if (row.status === "invisible" && !isSelf) continue;
      // two independent gates: online / last seen (0060), and the status details (0224)
      const visibility = visibilityById.get(row.user_id) ?? "everyone";
      const seenOk = isSelf || visibility === "everyone" || (visibility === "friends" && friendIds.has(row.user_id));
      const p = toPresenceRow(row);
      const detailsOk = audienceAllows(p.audience, { self: isSelf, friend: friendIds.has(row.user_id), inCircle: !!row.audience_circle && inCircles.has(row.audience_circle) });
      if (!seenOk && !detailsOk) continue;
      const eff = effectivePresence(p, schedules.get(row.user_id) ?? [], now);
      out.set(row.user_id, {
        // a hidden status reads as the ordinary default, exactly like a member who never set one
        status: detailsOk ? row.status : "available",
        lastActiveAt: seenOk ? row.updated_at : null,
        details: detailsOk ? { line: presenceLine(eff), autoReply: eff.autoReply, openTo: eff.openTo } : null,
      });
    }
  } catch {
    /* best-effort; a missing entry just means "available" (the default) at the call site */
  }
  return out;
}
