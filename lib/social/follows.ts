import "server-only";

import { emit } from "@/lib/platform/event-bus";
import { sendPushToUser } from "@/lib/push/web-push";
import { mutualFriendCount } from "@/lib/social/friend-requests/server";
import { followAllowance, followDecision, type FollowSource } from "@/lib/social/follow-policy";
import { resolveLabelInput } from "@/lib/social/graph/labels";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Followers™ — the follow decision and follow requests (Feature 19 · Part 3).
 *
 * `follows` (0006) stays the one follow graph. What this adds is the decision
 * in front of it: the target's follow_policy (0217) turns an attempt into a
 * follow, a request, or a refusal; the anti-automation allowance stops bursts;
 * and a request, when approved, becomes an ordinary follow row.
 *
 * Writes use the service role AFTER these checks. Since 0217 the follows RLS
 * insert policy only admits a direct client insert when the target's policy is
 * "everyone", so nobody can insert around an approval.
 *
 * Before 0217 runs, every read here degrades to today's behaviour: no policy
 * means "everyone", no follow_requests table means no requests.
 */
type Db = ReturnType<typeof createAdminClient>;
const DAY = 86_400_000;

export type FollowOutcome =
  | { ok: true; state: "following" | "requested"; fresh: boolean }
  | { ok: false; reason: "self" | "blocked" | "policy" | "hourly" | "daily" | "unavailable" };

const pair = (a: string, b: string) => (a < b ? [a, b] : [b, a]) as [string, string];

async function followPolicyOf(db: Db, userId: string): Promise<string> {
  try {
    const { data, error } = await db.from("privacy_settings").select("follow_policy").eq("user_id", userId).maybeSingle();
    if (error) return "everyone";
    return ((data as { follow_policy?: string } | null)?.follow_policy ?? "everyone") as string;
  } catch {
    return "everyone";
  }
}

async function blockedEitherWay(db: Db, a: string, b: string): Promise<boolean> {
  const { count } = await db
    .from("blocks")
    .select("blocker_id", { head: true, count: "exact" })
    .or(`and(blocker_id.eq.${a},blocked_id.eq.${b}),and(blocker_id.eq.${b},blocked_id.eq.${a})`);
  return (count ?? 0) > 0;
}

async function areFriends(db: Db, a: string, b: string): Promise<boolean> {
  const [low, high] = pair(a, b);
  const { count } = await db.from("friendships").select("user_low", { head: true, count: "exact" }).eq("user_low", low).eq("user_high", high);
  return (count ?? 0) > 0;
}

async function notify(db: Db, actorId: string, recipientId: string, verb: string, body: string, url: string, tag: string): Promise<void> {
  try {
    const { data: a } = await db.from("profiles").select("display_name, handle, avatar_url").eq("id", actorId).maybeSingle();
    const name = (a?.display_name as string) || (a?.handle ? `@${a.handle as string}` : "Someone");
    await sendPushToUser(recipientId, { title: `${name} ${verb}`, body, url, icon: (a?.avatar_url as string | null) ?? undefined, tag });
  } catch {
    /* a push is never the action */
  }
}

/** Follow — or ask to, under the target's policy. Idempotent. */
export async function followUser(viewerId: string, targetId: string, source: FollowSource | null, now: number = Date.now()): Promise<FollowOutcome> {
  if (viewerId === targetId) return { ok: false, reason: "self" };
  try {
    const db = createAdminClient();
    if (await blockedEitherWay(db, viewerId, targetId)) return { ok: false, reason: "blocked" };

    const { count: already } = await db.from("follows").select("follower_id", { head: true, count: "exact" }).eq("follower_id", viewerId).eq("following_id", targetId);
    if ((already ?? 0) > 0) return { ok: true, state: "following", fresh: false };

    const policy = await followPolicyOf(db, targetId);
    let decision = followDecision(policy, { isFriend: false, mutualFriends: 0, verified: false });
    if (decision !== "follow") {
      const [isFriend, { data: me }] = await Promise.all([areFriends(db, viewerId, targetId), db.from("profiles").select("is_verified").eq("id", viewerId).maybeSingle()]);
      const mutualFriends = policy === "friends_of_friends" && !isFriend ? await mutualFriendCount(db, viewerId, targetId) : 0;
      decision = followDecision(policy, { isFriend, mutualFriends, verified: !!(me as { is_verified?: boolean } | null)?.is_verified });
    }
    if (decision === "refuse") return { ok: false, reason: "policy" };

    // Smart Unfollow / anti-automation: the sender's own pace only
    const [{ data: prof }, { count: hour }, { count: day }] = await Promise.all([
      db.from("profiles").select("created_at").eq("id", viewerId).maybeSingle(),
      db.from("follows").select("following_id", { head: true, count: "exact" }).eq("follower_id", viewerId).gte("created_at", new Date(now - DAY / 24).toISOString()),
      db.from("follows").select("following_id", { head: true, count: "exact" }).eq("follower_id", viewerId).gte("created_at", new Date(now - DAY).toISOString()),
    ]);
    const created = (prof as { created_at?: string } | null)?.created_at;
    const allowance = followAllowance({ accountAgeDays: created ? Math.floor((now - Date.parse(created)) / DAY) : 0, followsLastHour: hour ?? 0, followsLastDay: day ?? 0 });
    if (!allowance.ok) return { ok: false, reason: allowance.reason };

    if (decision === "request") {
      const { error } = await db.from("follow_requests").insert({ requester_id: viewerId, target_id: targetId, ...(source ? { source } : {}) });
      if (error && error.code !== "23505") return { ok: false, reason: "unavailable" };
      if (!error) void notify(db, viewerId, targetId, "asked to follow you", "Approve or decline in Friends.", "/friends", `follow-req:${viewerId}`);
      return { ok: true, state: "requested", fresh: !error };
    }

    // `source` is 0217's column — before it runs, the follow is still made, without it
    let { error } = await db.from("follows").insert({ follower_id: viewerId, following_id: targetId, ...(source ? { source } : {}) });
    if (error && source && error.code !== "23505") ({ error } = await db.from("follows").insert({ follower_id: viewerId, following_id: targetId }));
    if (error && error.code !== "23505") return { ok: false, reason: "unavailable" };
    return { ok: true, state: "following", fresh: !error };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/** Unfollow, and withdraw a pending request. Idempotent. */
export async function unfollowUser(viewerId: string, targetId: string): Promise<void> {
  const db = createAdminClient();
  await db.from("follows").delete().eq("follower_id", viewerId).eq("following_id", targetId);
  try {
    await db
      .from("follow_requests")
      .update({ status: "cancelled", responded_at: new Date().toISOString() })
      .eq("requester_id", viewerId)
      .eq("target_id", targetId)
      .eq("status", "pending");
  } catch {
    /* before 0217 */
  }
}

/** Has the viewer asked to follow, and not yet been answered? (An ignored request still reads as asked.) */
export async function hasPendingFollowRequest(viewerId: string, targetId: string): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient()
      .from("follow_requests")
      .select("id")
      .eq("requester_id", viewerId)
      .eq("target_id", targetId)
      .in("status", ["pending", "ignored"])
      .limit(1);
    return !error && (data ?? []).length > 0;
  } catch {
    return false;
  }
}

export interface FollowRequestItem {
  id: string;
  createdAt: string;
  source: string | null;
  user: { id: string; handle: string; displayName: string; avatarUrl: string | null; isVerified: boolean; memberSince: string | null };
}

/** Pending follow requests sent to the user (ignored ones leave the list). */
export async function listFollowRequests(targetId: string, limit = 50): Promise<FollowRequestItem[]> {
  try {
    const db = createAdminClient();
    const { data, error } = await db
      .from("follow_requests")
      .select("id, requester_id, source, created_at")
      .eq("target_id", targetId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return [];
    const rows = (data as { id: string; requester_id: string; source: string | null; created_at: string }[]) ?? [];
    if (!rows.length) return [];
    const { data: profs } = await db.from("profiles").select("id, handle, display_name, avatar_url, is_verified, created_at").in("id", rows.map((r) => r.requester_id));
    const byId = new Map(((profs as { id: string; handle: string | null; display_name: string | null; avatar_url: string | null; is_verified: boolean | null; created_at: string | null }[]) ?? []).map((p) => [p.id, p]));
    return rows.flatMap((r) => {
      const p = byId.get(r.requester_id);
      if (!p?.handle) return [];
      return [{ id: r.id, createdAt: r.created_at, source: r.source, user: { id: p.id, handle: p.handle, displayName: p.display_name || p.handle, avatarUrl: p.avatar_url, isVerified: !!p.is_verified, memberSince: p.created_at } }];
    });
  } catch {
    return [];
  }
}

/**
 * Answer a follow request: approve (optionally with a private label — Approve
 * with Label), decline, or ignore (it leaves your list; the requester still sees
 * "Requested", which is true — it was never answered).
 */
export async function respondFollowRequest(targetId: string, requestId: string, action: "approve" | "decline" | "ignore", label?: string | null): Promise<boolean> {
  const db = createAdminClient();
  const { data: req } = await db.from("follow_requests").select("id, requester_id, source").eq("id", requestId).eq("target_id", targetId).eq("status", "pending").maybeSingle();
  const r = req as { id: string; requester_id: string; source: string | null } | null;
  if (!r) return false;
  const status = action === "approve" ? "approved" : action === "decline" ? "declined" : "ignored";
  const { error } = await db.from("follow_requests").update({ status, responded_at: new Date().toISOString() }).eq("id", r.id).eq("status", "pending");
  if (error) return false;
  if (action !== "approve") return true;

  const { error: fErr } = await db.from("follows").insert({ follower_id: r.requester_id, following_id: targetId, source: "request" });
  if (fErr && fErr.code !== "23505") return false;
  const resolved = label ? resolveLabelInput(label) : null;
  if (resolved && !("error" in resolved)) {
    const value = resolved.kind === "builtin" ? resolved.key : resolved.value;
    await db.from("relationship_labels").upsert({ owner_id: targetId, subject_id: r.requester_id, label: value, updated_at: new Date().toISOString() }, { onConflict: "owner_id,subject_id" });
  }
  emit("follow.created", { followerId: r.requester_id, followeeId: targetId });
  void notify(db, targetId, r.requester_id, "approved your follow request", "You can see their posts now.", "/home", `follow-ok:${targetId}`);
  return true;
}
