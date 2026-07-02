import { sendPushToUser } from "@/lib/push/web-push";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Frenz Connect — friendships (mutual, request-based; distinct from follows).
 * All writes run through here with the service role so blocks, anti-spam, the
 * in-app notification row and device push stay consistent. Migration 0020.
 *
 * Smart reminder (from the Feature 1 / Friend Request specs): when a request is
 * accepted, `reminder_due_at` is set 5 minutes out. `sendFriendReminders()` then
 * sends the sender ONE "Start chatting 👋" nudge — unless a conversation between
 * the pair already exists, which cancels it silently. Never duplicates.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

const pair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);

/** Max friend requests a user may send per rolling 24h (anti-spam). */
const DAILY_REQUEST_CAP = 20;
const REMINDER_DELAY_MS = 5 * 60 * 1000;

export type FriendshipState = "self" | "friends" | "outgoing" | "incoming" | "none";

export interface FriendProfile {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  isVerified: boolean;
}

export interface FriendRequestItem {
  id: string;
  note: string | null;
  createdAt: string;
  user: FriendProfile; // the other party (sender for incoming, receiver for outgoing)
}

export interface FriendItem {
  since: string;
  /** Private per-viewer star — favorites always sort to the top of the hub. */
  favorite: boolean;
  user: FriendProfile;
}

interface ProfileRow {
  id: string;
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
  is_verified: boolean | null;
}

function toProfile(r: ProfileRow): FriendProfile {
  return {
    id: r.id,
    handle: r.handle ?? "",
    displayName: r.display_name || (r.handle ? `@${r.handle}` : "Frenz user"),
    avatarUrl: r.avatar_url,
    isVerified: !!r.is_verified,
  };
}

async function loadProfiles(
  db: ReturnType<typeof createAdminClient>,
  ids: string[],
): Promise<Map<string, FriendProfile>> {
  if (ids.length === 0) return new Map();
  const { data } = await db
    .from("profiles")
    .select("id, handle, display_name, avatar_url, is_verified")
    .in("id", ids);
  return new Map(((data as ProfileRow[]) ?? []).map((r) => [r.id, toProfile(r)]));
}

async function eitherBlocked(
  db: ReturnType<typeof createAdminClient>,
  a: string,
  b: string,
): Promise<boolean> {
  const { count } = await db
    .from("blocks")
    .select("blocker_id", { head: true, count: "exact" })
    .or(`and(blocker_id.eq.${a},blocked_id.eq.${b}),and(blocker_id.eq.${b},blocked_id.eq.${a})`);
  return (count ?? 0) > 0;
}

async function areFriends(
  db: ReturnType<typeof createAdminClient>,
  a: string,
  b: string,
): Promise<boolean> {
  const [low, high] = pair(a, b);
  const { count } = await db
    .from("friendships")
    .select("user_low", { head: true, count: "exact" })
    .eq("user_low", low)
    .eq("user_high", high);
  return (count ?? 0) > 0;
}

/** Relationship between viewer and target, for rendering the profile button. */
export async function friendshipState(viewerId: string, targetId: string): Promise<FriendshipState> {
  if (!hasSupabase) return "none";
  if (viewerId === targetId) return "self";
  try {
    const db = createAdminClient();
    if (await areFriends(db, viewerId, targetId)) return "friends";
    const { data: pending } = await db
      .from("friend_requests")
      .select("sender_id")
      .eq("status", "pending")
      .or(
        `and(sender_id.eq.${viewerId},receiver_id.eq.${targetId}),and(sender_id.eq.${targetId},receiver_id.eq.${viewerId})`,
      )
      .limit(1)
      .maybeSingle();
    if (!pending) return "none";
    return pending.sender_id === viewerId ? "outgoing" : "incoming";
  } catch {
    return "none";
  }
}

/** Ids of a user's friends (both directions of the canonical pair). */
async function friendIds(db: ReturnType<typeof createAdminClient>, userId: string): Promise<string[]> {
  const { data } = await db
    .from("friendships")
    .select("user_low, user_high")
    .or(`user_low.eq.${userId},user_high.eq.${userId}`);
  return ((data as { user_low: string; user_high: string }[]) ?? []).map((r) =>
    r.user_low === userId ? r.user_high : r.user_low,
  );
}

/** How many friends `a` and `b` share (shown in the request modal). */
export async function mutualFriendsCount(a: string, b: string): Promise<number> {
  if (!hasSupabase) return 0;
  try {
    const db = createAdminClient();
    const [fa, fb] = await Promise.all([friendIds(db, a), friendIds(db, b)]);
    const set = new Set(fa);
    return fb.filter((id) => set.has(id)).length;
  } catch {
    return 0;
  }
}

export type FriendActionResult =
  | { ok: true; state: FriendshipState }
  | { ok: false; reason: "self" | "blocked" | "exists" | "incoming" | "cap" | "unavailable" };

/** Send a friend request (with optional ≤150-char note). Notifies + pushes the receiver. */
export async function sendFriendRequest(
  senderId: string,
  receiverId: string,
  note?: string | null,
): Promise<FriendActionResult> {
  if (!hasSupabase) return { ok: false, reason: "unavailable" };
  if (senderId === receiverId) return { ok: false, reason: "self" };
  try {
    const db = createAdminClient();

    const { data: rec } = await db
      .from("profiles")
      .select("is_suspended, handle")
      .eq("id", receiverId)
      .maybeSingle();
    if (!rec || rec.is_suspended || !rec.handle) return { ok: false, reason: "unavailable" };
    if (await eitherBlocked(db, senderId, receiverId)) return { ok: false, reason: "blocked" };
    if (await areFriends(db, senderId, receiverId)) return { ok: false, reason: "exists" };

    // If they already asked *you*, don't create a crossing request — surface theirs.
    const { count: incoming } = await db
      .from("friend_requests")
      .select("id", { head: true, count: "exact" })
      .eq("sender_id", receiverId)
      .eq("receiver_id", senderId)
      .eq("status", "pending");
    if ((incoming ?? 0) > 0) return { ok: false, reason: "incoming" };

    // Rolling 24h cap — keeps requests meaningful (anti-spam per the spec).
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: sentToday } = await db
      .from("friend_requests")
      .select("id", { head: true, count: "exact" })
      .eq("sender_id", senderId)
      .gte("created_at", dayAgo);
    if ((sentToday ?? 0) >= DAILY_REQUEST_CAP) return { ok: false, reason: "cap" };

    const trimmed = note?.trim().slice(0, 150) || null;
    const { error } = await db
      .from("friend_requests")
      .insert({ sender_id: senderId, receiver_id: receiverId, note: trimmed });
    // Unique pending index — a duplicate send is an idempotent success.
    if (error && error.code !== "23505") return { ok: false, reason: "unavailable" };

    if (!error) {
      await db
        .from("notifications")
        .insert({ user_id: receiverId, actor_id: senderId, type: "friend_request" })
        .then(() => {});
      void notifyPush(db, senderId, receiverId, {
        verb: "sent you a friend request",
        body: trimmed ?? "Open Frenz to accept.",
        url: "/friends",
        tag: `friend-req:${senderId}`,
      });
    }
    return { ok: true, state: "outgoing" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/** Accept or decline the pending request the other user sent you. */
export async function respondToFriendRequest(
  userId: string,
  otherId: string,
  action: "accept" | "decline",
): Promise<FriendActionResult> {
  if (!hasSupabase) return { ok: false, reason: "unavailable" };
  try {
    const db = createAdminClient();
    const { data: req } = await db
      .from("friend_requests")
      .select("id, sender_id")
      .eq("sender_id", otherId)
      .eq("receiver_id", userId)
      .eq("status", "pending")
      .maybeSingle();
    if (!req) return { ok: false, reason: "unavailable" };

    if (action === "decline") {
      await db
        .from("friend_requests")
        .update({ status: "declined", responded_at: new Date().toISOString() })
        .eq("id", req.id)
        .eq("status", "pending");
      return { ok: true, state: "none" };
    }

    const now = new Date();
    const { error } = await db
      .from("friend_requests")
      .update({
        status: "accepted",
        responded_at: now.toISOString(),
        reminder_due_at: new Date(now.getTime() + REMINDER_DELAY_MS).toISOString(),
      })
      .eq("id", req.id)
      .eq("status", "pending");
    if (error) return { ok: false, reason: "unavailable" };

    const [low, high] = pair(userId, otherId);
    await db
      .from("friendships")
      .upsert({ user_low: low, user_high: high, request_id: req.id }, { onConflict: "user_low,user_high" });

    await db
      .from("notifications")
      .insert({ user_id: otherId, actor_id: userId, type: "friend_accepted" })
      .then(() => {});
    void notifyPush(db, userId, otherId, {
      verb: "accepted your friend request 🎉",
      body: "You're now friends on Frenz.",
      url: `/messages/new/${userId}`,
      tag: `friend-acc:${userId}`,
    });
    return { ok: true, state: "friends" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/** Cancel your own pending request (also retracts the receiver's notification). */
export async function cancelFriendRequest(userId: string, otherId: string): Promise<FriendActionResult> {
  if (!hasSupabase) return { ok: false, reason: "unavailable" };
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("friend_requests")
      .update({ status: "cancelled", responded_at: new Date().toISOString() })
      .eq("sender_id", userId)
      .eq("receiver_id", otherId)
      .eq("status", "pending")
      .select("id");
    if ((data ?? []).length > 0) {
      await db
        .from("notifications")
        .delete()
        .eq("user_id", otherId)
        .eq("actor_id", userId)
        .eq("type", "friend_request");
    }
    return { ok: true, state: "none" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/** Remove an existing friendship (either side may). Clears both users' stars. */
export async function unfriend(userId: string, otherId: string): Promise<FriendActionResult> {
  if (!hasSupabase) return { ok: false, reason: "unavailable" };
  try {
    const db = createAdminClient();
    const [low, high] = pair(userId, otherId);
    await db.from("friendships").delete().eq("user_low", low).eq("user_high", high);
    await db
      .from("friend_favorites")
      .delete()
      .or(
        `and(user_id.eq.${userId},friend_id.eq.${otherId}),and(user_id.eq.${otherId},friend_id.eq.${userId})`,
      );
    return { ok: true, state: "none" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/** Star/unstar a friend (private to the viewer). Requires an actual friendship. */
export async function setFriendFavorite(
  userId: string,
  friendId: string,
  on: boolean,
): Promise<boolean> {
  if (!hasSupabase) return false;
  try {
    const db = createAdminClient();
    if (on) {
      if (!(await areFriends(db, userId, friendId))) return false;
      const { error } = await db
        .from("friend_favorites")
        .upsert({ user_id: userId, friend_id: friendId }, { onConflict: "user_id,friend_id" });
      return !error;
    }
    await db.from("friend_favorites").delete().eq("user_id", userId).eq("friend_id", friendId);
    return true;
  } catch {
    return false;
  }
}

export interface FriendsOverview {
  friends: FriendItem[];
  incoming: FriendRequestItem[];
  outgoing: FriendRequestItem[];
}

/** Everything the /friends hub needs, in one call. */
export async function friendsOverview(userId: string, limit = 100): Promise<FriendsOverview> {
  if (!hasSupabase) return { friends: [], incoming: [], outgoing: [] };
  try {
    const db = createAdminClient();
    const [{ data: fr }, { data: inc }, { data: out }, { data: fav }] = await Promise.all([
      db
        .from("friendships")
        .select("user_low, user_high, created_at")
        .or(`user_low.eq.${userId},user_high.eq.${userId}`)
        .order("created_at", { ascending: false })
        .limit(limit),
      db
        .from("friend_requests")
        .select("id, sender_id, note, created_at")
        .eq("receiver_id", userId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(50),
      db
        .from("friend_requests")
        .select("id, receiver_id, note, created_at")
        .eq("sender_id", userId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(50),
      db.from("friend_favorites").select("friend_id").eq("user_id", userId),
    ]);
    const favorites = new Set(((fav as { friend_id: string }[]) ?? []).map((r) => r.friend_id));

    const friendships = (fr as { user_low: string; user_high: string; created_at: string }[]) ?? [];
    const incomingRows = (inc as { id: string; sender_id: string; note: string | null; created_at: string }[]) ?? [];
    const outgoingRows = (out as { id: string; receiver_id: string; note: string | null; created_at: string }[]) ?? [];

    const ids = new Set<string>();
    for (const f of friendships) ids.add(f.user_low === userId ? f.user_high : f.user_low);
    for (const r of incomingRows) ids.add(r.sender_id);
    for (const r of outgoingRows) ids.add(r.receiver_id);
    const profiles = await loadProfiles(db, [...ids]);

    const item = (id: string): FriendProfile | null => profiles.get(id) ?? null;
    return {
      friends: friendships
        .map((f) => {
          const u = item(f.user_low === userId ? f.user_high : f.user_low);
          return u ? { since: f.created_at, favorite: favorites.has(u.id), user: u } : null;
        })
        .filter((x): x is FriendItem => !!x)
        // Favorites always on top (spec), newest friendship first within each group.
        .sort((a, b) => Number(b.favorite) - Number(a.favorite)),
      incoming: incomingRows
        .map((r) => {
          const u = item(r.sender_id);
          return u ? { id: r.id, note: r.note, createdAt: r.created_at, user: u } : null;
        })
        .filter((x): x is FriendRequestItem => !!x),
      outgoing: outgoingRows
        .map((r) => {
          const u = item(r.receiver_id);
          return u ? { id: r.id, note: r.note, createdAt: r.created_at, user: u } : null;
        })
        .filter((x): x is FriendRequestItem => !!x),
    };
  } catch {
    return { friends: [], incoming: [], outgoing: [] };
  }
}

/**
 * Smart reminder worker: for accepted requests 5+ minutes old with no reminder
 * yet, nudge the SENDER once — "Start chatting 👋" — unless the pair already has
 * a conversation (auto-cancel). Safe to call often; cheap when nothing is due.
 */
export async function sendFriendReminders(): Promise<number> {
  if (!hasSupabase) return 0;
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("friend_requests")
      .select("id, sender_id, receiver_id")
      .eq("status", "accepted")
      .eq("reminder_sent", false)
      .lte("reminder_due_at", new Date().toISOString())
      .limit(50);
    const due = (data as { id: string; sender_id: string; receiver_id: string }[]) ?? [];
    if (due.length === 0) return 0;

    let sent = 0;
    for (const r of due) {
      // Mark first — even if the send fails we never risk a duplicate nudge.
      await db.from("friend_requests").update({ reminder_sent: true }).eq("id", r.id);

      const [low, high] = pair(r.sender_id, r.receiver_id);
      const { count } = await db
        .from("conversations")
        .select("id", { head: true, count: "exact" })
        .eq("user_low", low)
        .eq("user_high", high);
      if ((count ?? 0) > 0) continue; // they're already chatting — auto-cancel

      await db
        .from("notifications")
        .insert({ user_id: r.sender_id, actor_id: r.receiver_id, type: "friend_reminder" })
        .then(() => {});
      const { data: friend } = await db
        .from("profiles")
        .select("display_name, handle")
        .eq("id", r.receiver_id)
        .maybeSingle();
      const name =
        (friend?.display_name as string) || (friend?.handle ? `@${friend.handle as string}` : "your new friend");
      await sendPushToUser(r.sender_id, {
        title: `Start chatting with ${name} 👋`,
        body: "You're now friends on Frenz — say hello.",
        url: `/messages/new/${r.receiver_id}`,
        tag: `friend-rem:${r.receiver_id}`,
      });
      sent++;
    }
    return sent;
  } catch {
    return 0;
  }
}

// Opportunistic runner — lets reminders fire near-on-time without dedicated cron
// infra: hot API routes call this and it self-throttles per server instance.
// (`reminder_sent` guarantees at-most-once even across instances.)
let lastReminderRun = 0;
export function runFriendRemindersSoon(): void {
  const now = Date.now();
  if (now - lastReminderRun < 60_000) return;
  lastReminderRun = now;
  void sendFriendReminders();
}

/** Actor-name push shared by request/accept events. */
async function notifyPush(
  db: ReturnType<typeof createAdminClient>,
  actorId: string,
  recipientId: string,
  opts: { verb: string; body: string; url: string; tag: string },
): Promise<void> {
  try {
    const { data: actor } = await db
      .from("profiles")
      .select("display_name, handle")
      .eq("id", actorId)
      .maybeSingle();
    const name =
      (actor?.display_name as string) || (actor?.handle ? `@${actor.handle as string}` : "Someone");
    await sendPushToUser(recipientId, {
      title: `${name} ${opts.verb}`,
      body: opts.body,
      url: opts.url,
      tag: opts.tag,
    });
  } catch {
    /* push is best-effort */
  }
}
