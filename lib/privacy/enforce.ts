import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

import { connectAllowed } from "./relationship";

/**
 * Relationship Privacy™ enforcement (Feature 19 · Part 17) — the one server check
 * for "who can mention / invite me", used where the action happens (collaboration
 * invites, the Permission Graph). Mentions are enforced in SQL by the comment
 * trigger itself (0232), so a mention can't slip past an app path.
 *
 * Before 0232 runs the column doesn't exist and the answer is today's behaviour
 * (allowed) — a missing migration never blocks people who could connect before.
 */
export async function connectPolicyAllows(db: ReturnType<typeof createAdminClient>, memberId: string, actorId: string, column: "mention_policy" | "collab_invite_policy"): Promise<boolean> {
  const { data, error } = await db.from("privacy_settings").select(column).eq("user_id", memberId).maybeSingle();
  if (error) return true;
  const policy = ((data as Record<string, unknown> | null)?.[column] as string | undefined) ?? "everyone";
  if (policy === "everyone") return true;
  if (policy === "nobody") return false;
  const [lo, hi] = memberId < actorId ? [memberId, actorId] : [actorId, memberId];
  const [fr, fo] = await Promise.all([
    db.from("friendships").select("user_low").eq("user_low", lo).eq("user_high", hi).maybeSingle(),
    db.from("follows").select("follower_id").eq("follower_id", memberId).eq("following_id", actorId).maybeSingle(),
  ]);
  return connectAllowed(policy, { isFriend: !!fr.data, memberFollowsActor: !!fo.data });
}

/**
 * Friend Request Filters™ (0232): does this request go to the quiet pile instead of
 * notifying? Only the receiver's own filters decide; the sender is never told (the
 * request is still sent and the receiver can review it). Fails open to "notify".
 */
export async function requestFiltered(db: ReturnType<typeof createAdminClient>, senderId: string, receiverId: string): Promise<boolean> {
  const { data, error } = await db.from("privacy_settings").select("request_filters").eq("user_id", receiverId).maybeSingle();
  if (error) return false;
  const f = ((data as Record<string, unknown> | null)?.request_filters ?? {}) as { noPhoto?: boolean; minAccountDays?: number };
  if (!f.noPhoto && !f.minAccountDays) return false;
  const { data: p } = await db.from("profiles").select("avatar_url, created_at").eq("id", senderId).maybeSingle();
  const prof = p as { avatar_url?: string | null; created_at?: string } | null;
  if (!prof) return false;
  if (f.noPhoto && !prof.avatar_url) return true;
  if (f.minAccountDays && prof.created_at && Date.now() - Date.parse(prof.created_at) < f.minAccountDays * 86_400_000) return true;
  return false;
}
