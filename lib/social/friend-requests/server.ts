import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { mutualDisclosureAllowed } from "@/lib/social/graph/store";

import { DECLINE_COOLDOWN_DAYS, noteFingerprint, REQUEST_EXPIRES_DAYS, type RequestSource, type SenderFacts } from "./trust";

/**
 * Friend Requests™ — the reads the trust workflow needs (Feature 19 · Part 2).
 *
 * Every function here fails OPEN for the person being protected and CLOSED for
 * nobody: a missing 0216 table or column (the migration runs by hand) means
 * "no ignores yet", "no policy set", "no source" — today's behaviour — never an
 * error in someone's friend list.
 */
type Db = ReturnType<typeof createAdminClient>;

const DAY = 24 * 60 * 60 * 1000;
const isoAgo = (ms: number, now: number) => new Date(now - ms).toISOString();

async function friendIdsOf(db: Db, userId: string): Promise<string[]> {
  const { data } = await db.from("friendships").select("user_low, user_high").or(`user_low.eq.${userId},user_high.eq.${userId}`);
  return ((data as { user_low: string; user_high: string }[]) ?? []).map((r) => (r.user_low === userId ? r.user_high : r.user_low));
}

/** The receiver's policy for incoming requests; the default before 0216 or with no row. */
export async function requestPolicyOf(db: Db, receiverId: string): Promise<string> {
  try {
    const { data, error } = await db.from("privacy_settings").select("friend_requests_policy").eq("user_id", receiverId).maybeSingle();
    if (error) return "everyone";
    return ((data as { friend_requests_policy?: string } | null)?.friend_requests_policy ?? "everyone") as string;
  } catch {
    return "everyone";
  }
}

export async function mutualFriendCount(db: Db, a: string, b: string): Promise<number> {
  const [fa, fb] = await Promise.all([friendIdsOf(db, a), friendIdsOf(db, b)]);
  const set = new Set(fa);
  return fb.filter((id) => set.has(id)).length;
}

/** What the adaptive limit needs to know about a sender — their OWN behaviour only. */
export async function senderFacts(db: Db, senderId: string, now: number = Date.now()): Promise<SenderFacts> {
  const [{ data: prof }, friends, { data: week }] = await Promise.all([
    db.from("profiles").select("created_at, is_verified").eq("id", senderId).maybeSingle(),
    friendIdsOf(db, senderId),
    db.from("friend_requests").select("id, status, created_at").eq("sender_id", senderId).gte("created_at", isoAgo(7 * DAY, now)).limit(500),
  ]);
  const p = prof as { created_at?: string; is_verified?: boolean } | null;
  const rows = (week as { id: string; status: string; created_at: string }[]) ?? [];
  // an ignore is a refusal the sender cannot see — it still counts against mass-invitation
  let ignored = 0;
  if (rows.length) {
    try {
      const { data: ig, error } = await db.from("friend_request_ignores").select("request_id").in("request_id", rows.map((r) => r.id));
      if (!error) ignored = (ig ?? []).length;
    } catch {
      /* before 0216 */
    }
  }
  const t = (s: string) => Date.parse(s);
  return {
    accountAgeDays: p?.created_at ? Math.floor((now - t(p.created_at)) / DAY) : 0,
    verified: !!p?.is_verified,
    friends: friends.length,
    sentLastDay: rows.filter((r) => now - t(r.created_at) < DAY).length,
    sentLastHour: rows.filter((r) => now - t(r.created_at) < DAY / 24).length,
    sentLastWeek: rows.length,
    refusedLastWeek: rows.filter((r) => r.status === "declined").length + ignored,
  };
}

/** How many different people got this same note from this sender in the last 24 h. */
export async function sameNoteSentToday(db: Db, senderId: string, note: string, now: number = Date.now()): Promise<number> {
  const fp = noteFingerprint(note);
  if (!fp) return 0;
  const { data } = await db.from("friend_requests").select("receiver_id, note").eq("sender_id", senderId).gte("created_at", isoAgo(DAY, now)).not("note", "is", null).limit(200);
  const receivers = new Set(((data as { receiver_id: string; note: string | null }[]) ?? []).filter((r) => r.note && noteFingerprint(r.note) === fp).map((r) => r.receiver_id));
  return receivers.size;
}

/**
 * Did the receiver decline this sender within the cool-down? Then the sender may
 * not ask again yet. (An IGNORED request needs no check here: it is still
 * pending, and the one-pending-request-per-pair index already makes a repeat an
 * idempotent no-op.)
 */
export async function recentlyRefused(db: Db, senderId: string, receiverId: string, now: number = Date.now()): Promise<boolean> {
  const { data } = await db
    .from("friend_requests")
    .select("id, status, responded_at")
    .eq("sender_id", senderId)
    .eq("receiver_id", receiverId)
    .eq("status", "declined")
    .gte("responded_at", isoAgo(DECLINE_COOLDOWN_DAYS * DAY, now))
    .limit(1);
  return (data ?? []).length > 0;
}

/** Ids of the receiver's requests they ignored. */
export async function ignoredRequestIds(db: Db, receiverId: string): Promise<Set<string>> {
  try {
    const { data, error } = await db.from("friend_request_ignores").select("request_id").eq("receiver_id", receiverId).limit(1000);
    if (error) return new Set();
    return new Set(((data as { request_id: string }[]) ?? []).map((r) => r.request_id));
  } catch {
    return new Set();
  }
}

/**
 * Requests nobody answered for REQUEST_EXPIRES_DAYS stop asking: marked
 * "expired" (allowed since 0020), which also frees the pair for a fresh request.
 * Run lazily when the receiver's list is read — no cron, no idle cost.
 */
export async function expireStaleRequests(db: Db, receiverId: string, now: number = Date.now()): Promise<void> {
  await db
    .from("friend_requests")
    .update({ status: "expired", responded_at: new Date(now).toISOString() })
    .eq("receiver_id", receiverId)
    .eq("status", "pending")
    .lt("created_at", isoAgo(REQUEST_EXPIRES_DAYS * DAY, now));
}

export interface RequestContext {
  /** Friends the receiver and the sender share — counted only over people who allow it; null when unknown. */
  mutualFriends: number | null;
  /** When the sender joined Frenz (profiles.created_at). */
  memberSince: string | null;
  source: RequestSource | null;
}

/**
 * The context on each incoming request card: mutual friends, time on Frenz and
 * where it came from. Mutuals are COUNTED, never named here, and only over
 * accounts that allow being counted (show_mutual_connections, 0112). Bounded:
 * the first 20 requests get a mutual count; the rest show without one.
 */
export async function requestContexts(db: Db, receiverId: string, rows: { id: string; sender_id: string }[]): Promise<Map<string, RequestContext>> {
  const out = new Map<string, RequestContext>();
  if (rows.length === 0) return out;
  const senderIds = [...new Set(rows.map((r) => r.sender_id))];
  const [mine, { data: profs }, sources] = await Promise.all([
    friendIdsOf(db, receiverId),
    db.from("profiles").select("id, created_at").in("id", senderIds),
    (async () => {
      try {
        const { data, error } = await db.from("friend_requests").select("id, source").in("id", rows.map((r) => r.id));
        return error ? new Map<string, string | null>() : new Map(((data as { id: string; source: string | null }[]) ?? []).map((r) => [r.id, r.source]));
      } catch {
        return new Map<string, string | null>();
      }
    })(),
  ]);
  const joined = new Map(((profs as { id: string; created_at: string | null }[]) ?? []).map((p) => [p.id, p.created_at]));
  const mySet = new Set(mine);
  const counted = senderIds.slice(0, 20);
  const theirs = await Promise.all(counted.map((id) => friendIdsOf(db, id).catch(() => [] as string[])));
  const candidateMutuals = new Set<string>();
  theirs.forEach((ids) => ids.forEach((id) => mySet.has(id) && candidateMutuals.add(id)));
  const allowed = await mutualDisclosureAllowed([...candidateMutuals]);
  const mutualBySender = new Map(counted.map((id, i) => [id, theirs[i]!.filter((f) => mySet.has(f) && allowed.has(f)).length]));
  for (const r of rows) {
    out.set(r.id, {
      mutualFriends: mutualBySender.get(r.sender_id) ?? null,
      memberSince: joined.get(r.sender_id) ?? null,
      source: (sources.get(r.id) as RequestSource | null | undefined) ?? null,
    });
  }
  return out;
}
