import "server-only";

import { connectPolicyAllows } from "@/lib/privacy/enforce";
import { decideFollow } from "@/lib/social/follows";
import { canMessage } from "@/lib/social/messages";
import { getMemory } from "@/lib/social/memories/server";
import { hasActiveSub } from "@/lib/sub/server";
import { createAdminClient } from "@/lib/supabase/admin";

import { canSeeFriendList, relationshipPrivacy } from "./store";

/**
 * Permission Graph™ (Feature 19 · Part 15) — "can this person do this, to that?"
 *
 * ONE explainable entry point over the checks that already decide these things.
 * It does not re-implement any rule: messaging is `canMessage`, following is the
 * member's follow policy (`followDecision`), the friend list is
 * `canSeeFriendList`, subscriber posts are `hasActiveSub`, a memory is
 * `getMemory`. So there is still exactly one place each rule lives, and every
 * surface (and the future ones) can ask the same question the same way and get a
 * reason back, not a bare boolean. Unknown actions fail closed.
 */

export const GRAPH_ACTIONS = ["message", "follow", "mention", "view_friends", "view_sub_posts", "view_memory", "add_to_memory", "invite_collaborator", "moderate_community"] as const;
export type GraphAction = (typeof GRAPH_ACTIONS)[number];

export interface Permission {
  allowed: boolean;
  /** what the viewer can do instead, or why not — never reveals a private setting of the other side */
  reason: string;
  /** "request" when the answer is "ask first" (a follow request) */
  via?: "request";
}

type Row = Record<string, unknown>;

async function isFriend(db: ReturnType<typeof createAdminClient>, a: string, b: string): Promise<boolean> {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  const { data } = await db.from("friendships").select("user_low").eq("user_low", lo).eq("user_high", hi).maybeSingle();
  return !!data;
}

async function blockedEitherWay(db: ReturnType<typeof createAdminClient>, a: string, b: string): Promise<boolean> {
  const { data } = await db.from("blocks").select("blocker_id").or(`and(blocker_id.eq.${a},blocked_id.eq.${b}),and(blocker_id.eq.${b},blocked_id.eq.${a})`).limit(1);
  return (data ?? []).length > 0;
}

/** `target` is a user id, or for view_memory a memory id. */
export async function can(viewerId: string, action: GraphAction, target: string): Promise<Permission> {
  const db = createAdminClient();
  if (action !== "view_memory" && viewerId === target) return { allowed: action !== "message" && action !== "follow", reason: "That's you." };
  switch (action) {
    case "message": {
      const g = await canMessage(viewerId, target);
      if (g.ok) return { allowed: true, reason: "You can message them." };
      const why: Record<string, string> = { blocked: "Messaging isn't available between you.", off: "They aren't taking new messages.", followers: "They only take messages from people they follow.", unavailable: "This account isn't available.", self: "That's you." };
      return { allowed: false, reason: why[g.reason] ?? "Not available." };
    }
    case "follow": {
      if (await blockedEitherWay(db, viewerId, target)) return { allowed: false, reason: "Not available." };
      const d = await decideFollow(db, viewerId, target);
      return d === "follow" ? { allowed: true, reason: "You can follow them." } : d === "request" ? { allowed: true, via: "request", reason: "They approve followers first: you can send a request." } : { allowed: false, reason: "They aren't taking new followers right now." };
    }
    case "view_friends": {
      const [privacy, friend] = await Promise.all([relationshipPrivacy(target), isFriend(db, viewerId, target)]);
      return canSeeFriendList(privacy, friend ? "friend" : "stranger") ? { allowed: true, reason: "Their friend list is visible to you." } : { allowed: false, reason: "They keep their friend list private." };
    }
    case "view_sub_posts":
      return (await hasActiveSub(viewerId, target)) ? { allowed: true, reason: "You have an active subscription." } : { allowed: false, reason: "Subscribe to see their SUB POSTS." };
    case "view_memory":
      return (await getMemory(viewerId, target)) ? { allowed: true, reason: "This memory is shared with you." } : { allowed: false, reason: "This memory isn't shared with you." };
    case "add_to_memory":
      if (await blockedEitherWay(db, viewerId, target)) return { allowed: false, reason: "Not available." };
      if (!(await isFriend(db, viewerId, target))) return { allowed: false, reason: "Only friends can be added to a memory." };
      {
        const { data: pol } = await db.from("privacy_settings").select("memory_tag_policy").eq("user_id", target).maybeSingle();
        if ((pol as Row | null)?.memory_tag_policy === "nobody") return { allowed: false, reason: "They've chosen not to be added to memories." };
      }
      return { allowed: true, reason: "You're friends, so you can add them to a memory." };
    case "invite_collaborator":
      // mirrors lib/creator/collab.ts inviteCollaborator: not blocked, and their collaboration-invite setting (0232)
      if (await blockedEitherWay(db, viewerId, target)) return { allowed: false, reason: "Not available." };
      return (await connectPolicyAllows(db, target, viewerId, "collab_invite_policy")) ? { allowed: true, reason: "You can invite them; they accept or decline." } : { allowed: false, reason: "They limit who can invite them to collaborate." };
    case "mention":
      // the comment trigger (0232) applies the same rule when a mention is written
      if (await blockedEitherWay(db, viewerId, target)) return { allowed: false, reason: "Not available." };
      return (await connectPolicyAllows(db, target, viewerId, "mention_policy")) ? { allowed: true, reason: "Your mentions reach them." } : { allowed: false, reason: "They limit who can notify them with a mention." };
    case "moderate_community": {
      // can the VIEWER moderate the community of creator `target`?
      if (viewerId === target) return { allowed: true, reason: "It's your community." };
      const { data } = await db.from("creator_memberships").select("role, status").eq("creator_id", target).eq("member_id", viewerId).maybeSingle();
      const r = data as Row | null;
      return r?.status === "active" && r.role === "moderator" ? { allowed: true, reason: "The creator made you a moderator." } : { allowed: false, reason: "Only the creator and their moderators can moderate." };
    }
    default:
      return { allowed: false, reason: "Unknown action." };
  }
}
