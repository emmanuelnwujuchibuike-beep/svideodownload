import { after } from "next/server";

import {
  DEFAULT_CHAT_APPEARANCE,
  fromChatAppearanceRow,
  type ChatAppearance,
  type ChatAppearanceRow,
} from "@/lib/social/chat-appearance";

import { flagsOf, isAccountVisibleTo, relationTo } from "@/lib/social/account-visibility";
import { friendIdSet } from "@/lib/social/friend-ids";
import { CONVERSATION_THEMES, GROUP_TITLE_MAX, MAX_GROUP_MEMBERS, parseMentionedHandles, type ConversationTheme } from "@/lib/social/message-meta";
import { MAX_ATTACHMENTS_PER_MESSAGE, type AttachmentKind } from "@/lib/social/message-media";
import { createAdminClient } from "@/lib/supabase/admin";

export { CONVERSATION_THEMES, GROUP_TITLE_MAX, MAX_GROUP_MEMBERS, type ConversationTheme };

/**
 * Direct + group messaging. Direct conversations are keyed by a canonical
 * (low,high) pair, same as before; group conversations have no fixed pair —
 * membership for BOTH kinds lives in `conversation_members`. Starting a
 * direct thread is gated by the recipient's messages_policy + blocks;
 * replying in an existing conversation (direct or group) is always allowed
 * for an active member (unless blocked). Group invites are gated by blocks
 * PLUS the target's own `group_invite_policy` (0060, Part 11b) — being
 * added to a group by someone you know is a different trust action than a
 * cold 1:1 DM, so it has its own, separate control. Reads go through the service role +
 * explicit membership checks; there is still no client UPDATE/DELETE policy
 * on messages/conversations — every mutation funnels through this file.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

const pair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);

type Db = ReturnType<typeof createAdminClient>;
export type ConversationType = "direct" | "group" | "secret";
export type MemberRole = "owner" | "admin" | "member";

export interface OtherUser {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  isVerified: boolean;
}

export interface ConversationMember {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  isVerified: boolean;
  role: MemberRole;
}

export type MessageGate =
  | { ok: true }
  | { ok: false; reason: "self" | "blocked" | "off" | "followers" | "unavailable" };

/**
 * Full block (either direction) OR a granular "messaging" restriction
 * (either direction, migration 0076) between the pair — every call site here
 * is a messaging gate (start/continue a DM, group add/invite, actual send),
 * so a scoped "block them from chatting with me" (owner ask, 2026-07-14)
 * belongs in the same check as a full block, not a separate one callers
 * would have to remember to also add.
 */
async function bothBlocked(db: Db, a: string, b: string): Promise<boolean> {
  const [{ count: blockCount }, { count: restrictionCount }] = await Promise.all([
    db
      .from("blocks")
      .select("blocker_id", { head: true, count: "exact" })
      .or(`and(blocker_id.eq.${a},blocked_id.eq.${b}),and(blocker_id.eq.${b},blocked_id.eq.${a})`),
    db
      .from("user_restrictions")
      .select("restrictor_id", { head: true, count: "exact" })
      .eq("scope", "messaging")
      .or(`and(restrictor_id.eq.${a},restricted_id.eq.${b}),and(restrictor_id.eq.${b},restricted_id.eq.${a})`),
  ]);
  return (blockCount ?? 0) > 0 || (restrictionCount ?? 0) > 0;
}

async function isFriend(db: Db, a: string, b: string): Promise<boolean> {
  const [low, high] = pair(a, b);
  const { count } = await db
    .from("friendships")
    .select("user_low", { head: true, count: "exact" })
    .eq("user_low", low)
    .eq("user_high", high);
  return (count ?? 0) > 0;
}

/** Part 11b: "who can add me to groups" — mirrors canMessage's shape but for
 *  the group-invite privacy control (0060). Blocks are checked separately
 *  by the caller (bothBlocked) — this only covers the new policy setting. */
async function canBeAddedToGroup(db: Db, actorId: string, targetId: string): Promise<boolean> {
  const { data: priv } = await db
    .from("privacy_settings")
    .select("group_invite_policy")
    .eq("user_id", targetId)
    .maybeSingle();
  const policy = (priv?.group_invite_policy as string) ?? "everyone";
  if (policy === "nobody") return false;
  if (policy === "friends") return isFriend(db, actorId, targetId);
  return true;
}

async function memberRole(db: Db, conversationId: string, userId: string): Promise<MemberRole | null> {
  const { data } = await db
    .from("conversation_members")
    .select("role")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .is("left_at", null)
    .maybeSingle();
  return (data?.role as MemberRole | undefined) ?? null;
}

/** Can `senderId` start/continue a DIRECT conversation with `recipientId`? */
export async function canMessage(senderId: string, recipientId: string): Promise<MessageGate> {
  if (!hasSupabase) return { ok: false, reason: "unavailable" };
  if (senderId === recipientId) return { ok: false, reason: "self" };
  try {
    const db = createAdminClient();

    // Both sides, one query — an admin hide (migration 0082) confines an account
    // to its existing friends in BOTH directions: a stranger can't open a chat
    // with a hidden account, and a hidden account can't open one with a stranger.
    // Existing friendships are deliberately untouched, which is the whole point
    // of a hide being a visibility measure rather than a suspension.
    const { data: profs } = await db
      .from("profiles")
      .select("id, is_suspended, is_hidden, handle")
      .in("id", [senderId, recipientId]);
    const rows = (profs ?? []) as { id: string; is_suspended: boolean; is_hidden: boolean; handle: string | null }[];
    const rec = rows.find((r) => r.id === recipientId);
    const me = rows.find((r) => r.id === senderId);
    if (!rec || !rec.handle) return { ok: false, reason: "unavailable" };

    const friends = await friendIdSet(senderId);
    const theyAreVisibleToMe = isAccountVisibleTo(flagsOf(rec), relationTo(recipientId, senderId, friends));
    const iAmVisibleToThem = isAccountVisibleTo(flagsOf(me), friends.has(recipientId) ? "friend" : "stranger");
    if (!theyAreVisibleToMe || !iAmVisibleToThem) return { ok: false, reason: "unavailable" };

    if (await bothBlocked(db, senderId, recipientId)) return { ok: false, reason: "blocked" };

    const [low, high] = pair(senderId, recipientId);
    const { data: existing } = await db
      .from("conversations")
      .select("id")
      .eq("user_low", low)
      .eq("user_high", high)
      .eq("type", "direct")
      .maybeSingle();
    if (existing) return { ok: true }; // can always continue an existing thread

    const { data: priv } = await db
      .from("privacy_settings")
      .select("messages_policy")
      .eq("user_id", recipientId)
      .maybeSingle();
    const policy = (priv?.messages_policy as string) ?? "followers";
    if (policy === "off") return { ok: false, reason: "off" };
    if (policy === "followers") {
      const { count } = await db
        .from("follows")
        .select("follower_id", { head: true, count: "exact" })
        .or(
          `and(follower_id.eq.${senderId},following_id.eq.${recipientId}),and(follower_id.eq.${recipientId},following_id.eq.${senderId})`,
        );
      if ((count ?? 0) === 0) return { ok: false, reason: "followers" };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/** Gate then get-or-create the direct conversation for a pair. */
export async function getOrCreateConversation(
  senderId: string,
  recipientId: string,
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const gate = await canMessage(senderId, recipientId);
  if (!gate.ok) return { ok: false, reason: gate.reason };
  const db = createAdminClient();
  const [low, high] = pair(senderId, recipientId);

  // Self-healing upsert: if a PRIOR call created the `conversations` row but
  // then failed/was interrupted before seeding `conversation_members` (no
  // error was ever checked on that insert), the pair would otherwise be
  // permanently stuck — every future call finds `existing` and returns early
  // without ever re-verifying membership, and sendMessage's own membership
  // check would then reject every send forever with no recovery path.
  // `onConflict: do nothing` makes this safe to run unconditionally.
  const seedMembers = async (conversationId: string) => {
    await db
      .from("conversation_members")
      .upsert(
        [
          { conversation_id: conversationId, user_id: low },
          { conversation_id: conversationId, user_id: high },
        ],
        { onConflict: "conversation_id,user_id", ignoreDuplicates: true },
      );
  };

  const { data: existing } = await db
    .from("conversations")
    .select("id")
    .eq("user_low", low)
    .eq("user_high", high)
    .eq("type", "direct")
    .maybeSingle();
  if (existing) {
    await seedMembers(existing.id as string);
    return { ok: true, id: existing.id as string };
  }

  const { data, error } = await db
    .from("conversations")
    .insert({ user_low: low, user_high: high, type: "direct" })
    .select("id")
    .single();
  if (error) {
    // Lost a create race → re-select.
    const { data: again } = await db
      .from("conversations")
      .select("id")
      .eq("user_low", low)
      .eq("user_high", high)
      .eq("type", "direct")
      .maybeSingle();
    if (again) {
      await seedMembers(again.id as string);
      return { ok: true, id: again.id as string };
    }
    return { ok: false, reason: "unavailable" };
  }
  await seedMembers(data.id as string);
  return { ok: true, id: data.id as string };
}

/**
 * Get-or-create a Secret Chat (Part 11b) — 1:1 only, real E2EE (see
 * migration 0062's header for the crypto model). Gated the same way a
 * regular DM is (messages_policy + blocks via `canMessage`) — Secret Chats
 * aren't a way around a "who can message me" restriction, just a more
 * private mode of an otherwise-normal conversation. Requires BOTH
 * participants to have already uploaded an encryption public key
 * (`user_encryption_keys`) — the caller (API route) checks this before
 * calling, since the client needs to know whether to prompt "generate your
 * secret-chat key first" rather than getting a generic failure here.
 */
export async function getOrCreateSecretConversation(
  senderId: string,
  recipientId: string,
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  if (!hasSupabase) return { ok: false, reason: "unavailable" };
  if (senderId === recipientId) return { ok: false, reason: "self" };
  const db = createAdminClient();
  const [low, high] = pair(senderId, recipientId);

  const seedMembers = async (conversationId: string) => {
    await db
      .from("conversation_members")
      .upsert(
        [
          { conversation_id: conversationId, user_id: low },
          { conversation_id: conversationId, user_id: high },
        ],
        { onConflict: "conversation_id,user_id", ignoreDuplicates: true },
      );
  };

  // Check for an existing thread BEFORE gating (mirrors canMessage's own
  // "can always continue an existing thread" rule) — canMessage only knows
  // about type="direct" existing threads, so a Secret Chat created while
  // messaging was allowed must stay reachable even if the recipient later
  // tightens messages_policy to "off"; otherwise a real, already-established
  // encrypted conversation silently becomes unreplyable.
  const { data: existing } = await db
    .from("conversations")
    .select("id")
    .eq("user_low", low)
    .eq("user_high", high)
    .eq("type", "secret")
    .maybeSingle();
  if (existing) {
    await seedMembers(existing.id as string);
    return { ok: true, id: existing.id as string };
  }

  const gate = await canMessage(senderId, recipientId);
  if (!gate.ok) return { ok: false, reason: gate.reason };

  const { data, error } = await db
    .from("conversations")
    .insert({ user_low: low, user_high: high, type: "secret" })
    .select("id")
    .single();
  if (error) {
    const { data: again } = await db
      .from("conversations")
      .select("id")
      .eq("user_low", low)
      .eq("user_high", high)
      .eq("type", "secret")
      .maybeSingle();
    if (again) {
      await seedMembers(again.id as string);
      return { ok: true, id: again.id as string };
    }
    return { ok: false, reason: "unavailable" };
  }
  await seedMembers(data.id as string);
  return { ok: true, id: data.id as string };
}

/** Create a group conversation. Creator becomes owner; invites gated by blocks only. */
export async function createGroupConversation(
  creatorId: string,
  memberIds: string[],
  title: string,
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  if (!hasSupabase) return { ok: false, reason: "unavailable" };
  const cleanTitle = title.trim().slice(0, GROUP_TITLE_MAX);
  if (!cleanTitle) return { ok: false, reason: "title_required" };
  const uniqueMembers = [...new Set(memberIds)].filter((id) => id !== creatorId);
  if (uniqueMembers.length === 0) return { ok: false, reason: "members_required" };
  if (uniqueMembers.length + 1 > MAX_GROUP_MEMBERS) return { ok: false, reason: "too_many_members" };

  try {
    const db = createAdminClient();
    for (const id of uniqueMembers) {
      if (await bothBlocked(db, creatorId, id)) return { ok: false, reason: "blocked" };
      if (!(await canBeAddedToGroup(db, creatorId, id))) return { ok: false, reason: "group_invite_restricted" };
    }

    const { data: conv, error } = await db
      .from("conversations")
      .insert({ type: "group", title: cleanTitle, created_by: creatorId })
      .select("id")
      .single();
    if (error || !conv) return { ok: false, reason: "unavailable" };

    const rows = [
      { conversation_id: conv.id, user_id: creatorId, role: "owner" as const },
      ...uniqueMembers.map((id) => ({ conversation_id: conv.id, user_id: id, role: "member" as const })),
    ];
    const { error: memberError } = await db.from("conversation_members").insert(rows);
    if (memberError) return { ok: false, reason: "unavailable" };

    return { ok: true, id: conv.id as string };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function addGroupMembers(
  conversationId: string,
  actorId: string,
  memberIds: string[],
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const db = createAdminClient();
    const { data: conv } = await db.from("conversations").select("type").eq("id", conversationId).maybeSingle();
    if (!conv || conv.type !== "group") return { ok: false, reason: "not_found" };
    const role = await memberRole(db, conversationId, actorId);
    if (role !== "owner" && role !== "admin") return { ok: false, reason: "forbidden" };

    const ids = [...new Set(memberIds)].filter((id) => id !== actorId);
    if (ids.length === 0) return { ok: true };

    const { count } = await db
      .from("conversation_members")
      .select("user_id", { head: true, count: "exact" })
      .eq("conversation_id", conversationId)
      .is("left_at", null);
    if ((count ?? 0) + ids.length > MAX_GROUP_MEMBERS) return { ok: false, reason: "too_many_members" };

    for (const id of ids) {
      if (await bothBlocked(db, actorId, id)) return { ok: false, reason: "blocked" };
      if (!(await canBeAddedToGroup(db, actorId, id))) return { ok: false, reason: "group_invite_restricted" };
    }

    // Upsert: cleanly re-adds a former (left) member instead of erroring on the PK.
    const { error } = await db.from("conversation_members").upsert(
      ids.map((id) => ({
        conversation_id: conversationId,
        user_id: id,
        role: "member" as const,
        left_at: null,
        joined_at: new Date().toISOString(),
      })),
      { onConflict: "conversation_id,user_id" },
    );
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}

/** `targetUserId === actorId` is a self-leave; otherwise the actor must be owner/admin. */
export async function removeGroupMember(
  conversationId: string,
  actorId: string,
  targetUserId: string,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const db = createAdminClient();
    // Direct conversations have no "leave" concept — without this, calling
    // this route with a DIRECT conversation id and your own user id set
    // `left_at` on your own DM membership (a direct member's role defaults to
    // "member", not "owner", so the self-removal branch below never caught
    // it), permanently locking you out of that conversation: both
    // getConversation() and sendMessage() require an active membership row,
    // and getOrCreateConversation()'s reseed uses ignoreDuplicates so it
    // never clears an existing left_at.
    const { data: conv } = await db.from("conversations").select("type").eq("id", conversationId).maybeSingle();
    if (conv?.type !== "group") return { ok: false, reason: "not_found" };

    const targetRole = await memberRole(db, conversationId, targetUserId);
    if (!targetRole) return { ok: false, reason: "not_found" };

    if (targetUserId === actorId) {
      if (targetRole === "owner") return { ok: false, reason: "owner_must_transfer" };
    } else {
      const actorRole = await memberRole(db, conversationId, actorId);
      if (actorRole !== "owner" && actorRole !== "admin") return { ok: false, reason: "forbidden" };
      if (targetRole === "owner") return { ok: false, reason: "cannot_remove_owner" };
    }

    const { error } = await db
      .from("conversation_members")
      .update({ left_at: new Date().toISOString() })
      .eq("conversation_id", conversationId)
      .eq("user_id", targetUserId);
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}

export async function renameGroup(
  conversationId: string,
  actorId: string,
  title: string,
): Promise<{ ok: boolean; reason?: string }> {
  const cleanTitle = title.trim().slice(0, GROUP_TITLE_MAX);
  if (!cleanTitle) return { ok: false, reason: "title_required" };
  try {
    const db = createAdminClient();
    const role = await memberRole(db, conversationId, actorId);
    if (role !== "owner" && role !== "admin") return { ok: false, reason: "forbidden" };
    const { error } = await db.from("conversations").update({ title: cleanTitle }).eq("id", conversationId).eq("type", "group");
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}

export async function setGroupAvatar(
  conversationId: string,
  actorId: string,
  avatarUrl: string | null,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const db = createAdminClient();
    const role = await memberRole(db, conversationId, actorId);
    if (role !== "owner" && role !== "admin") return { ok: false, reason: "forbidden" };
    const { error } = await db.from("conversations").update({ avatar_url: avatarUrl }).eq("id", conversationId).eq("type", "group");
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}

/** Owner/admin only — "only admins can send messages" toggle (owner ask, 2026-07-12). */
export async function setGroupSendPermission(
  conversationId: string,
  actorId: string,
  onlyAdminsCanSend: boolean,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const db = createAdminClient();
    const role = await memberRole(db, conversationId, actorId);
    if (role !== "owner" && role !== "admin") return { ok: false, reason: "forbidden" };
    const { error } = await db
      .from("conversations")
      .update({ only_admins_can_send: onlyAdminsCanSend })
      .eq("id", conversationId)
      .eq("type", "group");
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}

/**
 * Disappearing messages (Part 11b, migration 0061) — `seconds: null` turns
 * it off. Any active member may set it for a direct/secret conversation
 * (matching WhatsApp's 1:1 model); groups require owner/admin, same
 * precedent as `only_admins_can_send`. Actual deletion is a cron job
 * (app/api/cron/disappearing-messages), not this function — this only
 * flips the setting.
 */
/** "7 days" / "24 hours" / "3 days" — matches WhatsApp's own system-message phrasing. */
function humanizeDisappearDuration(seconds: number): string {
  if (seconds % 86_400 === 0) {
    const days = seconds / 86_400;
    return days === 1 ? "24 hours" : `${days} days`;
  }
  const hours = Math.round(seconds / 3600);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

export async function setDisappearAfterSeconds(
  conversationId: string,
  actorId: string,
  seconds: number | null,
): Promise<{ ok: boolean; reason?: string }> {
  if (seconds !== null && (!Number.isFinite(seconds) || seconds <= 0)) return { ok: false, reason: "invalid" };
  try {
    const db = createAdminClient();
    const { data: conv } = await db.from("conversations").select("type").eq("id", conversationId).maybeSingle();
    if (!conv) return { ok: false, reason: "not_found" };
    const role = await memberRole(db, conversationId, actorId);
    if (!role) return { ok: false, reason: "forbidden" };
    if (conv.type === "group" && role !== "owner" && role !== "admin") return { ok: false, reason: "forbidden" };
    const { error } = await db.from("conversations").update({ disappear_after_seconds: seconds }).eq("id", conversationId);
    if (error) return { ok: false };

    // WhatsApp-style in-chat system notice (owner ask, 2026-07-14): "let users
    // receive a notification in chat like whatsapp when a user turns on
    // disappearing message, showing the period... the user set." A real
    // message row (metadata.kind === "system"), not a toast — visible to
    // every member, persists in history, delivered over the SAME realtime
    // channel every other message already uses. Best-effort: a failure here
    // never undoes the setting change itself, which already succeeded.
    try {
      const { data: actorProf } = await db.from("profiles").select("display_name, handle").eq("id", actorId).maybeSingle();
      const actorName = (actorProf?.display_name as string | undefined) || (actorProf?.handle ? `@${actorProf.handle as string}` : "Someone");
      const text =
        seconds === null
          ? `${actorName} turned off disappearing messages.`
          : `${actorName} turned on disappearing messages. New messages will disappear from this chat ${humanizeDisappearDuration(seconds)} after they're sent.`;
      await sendMessage(actorId, conversationId, "", { metadata: { kind: "system", text } });
    } catch {
      /* the setting change itself already succeeded; the notice is best-effort */
    }

    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** Chat Themes — shared per-conversation (like disappearing messages, not a
 *  per-viewer preference): any active member can set it, no owner/admin gate
 *  — purely cosmetic, low-risk, unlike group rename/permissions. */
export async function setConversationTheme(
  conversationId: string,
  actorId: string,
  theme: ConversationTheme | null,
): Promise<{ ok: boolean }> {
  try {
    const db = createAdminClient();
    const role = await memberRole(db, conversationId, actorId);
    if (!role) return { ok: false };
    const { error } = await db.from("conversations").update({ theme }).eq("id", conversationId);
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}

/** Chat wallpaper (migration 0073) — a custom uploaded background picture,
 *  same shared-per-conversation / any-member-can-set model as Chat Theme. */
export async function setConversationWallpaper(
  conversationId: string,
  actorId: string,
  wallpaperUrl: string | null,
): Promise<{ ok: boolean }> {
  try {
    const db = createAdminClient();
    const role = await memberRole(db, conversationId, actorId);
    if (!role) return { ok: false };
    const { error } = await db.from("conversations").update({ wallpaper_url: wallpaperUrl }).eq("id", conversationId);
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}

/**
 * In-chat polls (inbox mockup completion) — creates the parent message (an
 * empty-body, metadata-tagged row, same shape a location/contact share
 * uses) then the poll row referencing it. Server-side only (mirrors
 * `message_attachments`'s D1 rule) — only VOTES are client-direct, for
 * low-latency tapping (see migration 0071's RLS).
 */
export async function createPoll(
  senderId: string,
  conversationId: string,
  question: string,
  options: string[],
): Promise<{ ok: true; messageId: string; pollId: string } | { ok: false }> {
  try {
    const sent = await sendMessage(senderId, conversationId, "", { metadata: { kind: "poll" } });
    if (!sent.ok) return { ok: false };
    const db = createAdminClient();
    const { data: poll, error } = await db
      .from("message_polls")
      .insert({ message_id: sent.id, conversation_id: conversationId, question, options, created_by: senderId })
      .select("id")
      .single();
    if (error || !poll) {
      // The parent message already landed (and was already broadcast live to
      // any open thread) before this insert could fail — left as-is, it's a
      // permanently-broken poll bubble (metadata says "poll", no pollId, no
      // row to fetch). Soft-delete it the same way a normal message delete
      // works, so it reads as "This message was deleted" instead of an
      // unfixable stuck loading skeleton — found in review, not guessed.
      await db.from("messages").update({ deleted_at: new Date().toISOString() }).eq("id", sent.id);
      return { ok: false };
    }
    // The bubble needs the poll's own id to fetch/vote — carried in the
    // parent message's metadata (set here, after the poll exists, since the
    // poll row itself needs the message's id first — see the insert above).
    await db.from("messages").update({ metadata: { kind: "poll", pollId: poll.id } }).eq("id", sent.id);
    return { ok: true, messageId: sent.id, pollId: poll.id as string };
  } catch {
    return { ok: false };
  }
}

export interface PollResults {
  id: string;
  question: string;
  options: string[];
  votesByOption: number[];
  totalVotes: number;
  viewerOptionIndex: number | null;
}

/** Poll question/options + live tally + the viewer's own vote (if any). Only
 *  a member of the poll's OWN conversation may read it — this uses the
 *  service-role client (bypasses RLS), so the membership check has to be
 *  explicit here, same as every other admin-client read in this file. */
export async function getPollResults(pollId: string, viewerId: string): Promise<PollResults | null> {
  try {
    const db = createAdminClient();
    const { data: poll } = await db.from("message_polls").select("id, question, options, conversation_id").eq("id", pollId).maybeSingle();
    if (!poll) return null;
    const role = await memberRole(db, poll.conversation_id as string, viewerId);
    if (!role) return null;
    const options = poll.options as string[];
    const { data: votes } = await db.from("message_poll_votes").select("user_id, option_index").eq("poll_id", pollId);
    const rows = (votes ?? []) as { user_id: string; option_index: number }[];
    const votesByOption = new Array(options.length).fill(0) as number[];
    for (const v of rows) if (v.option_index >= 0 && v.option_index < options.length) votesByOption[v.option_index]!++;
    const mine = rows.find((v) => v.user_id === viewerId);
    return {
      id: poll.id as string,
      question: poll.question as string,
      options,
      votesByOption,
      totalVotes: rows.length,
      viewerOptionIndex: mine ? mine.option_index : null,
    };
  } catch {
    return null;
  }
}

/** Cast/change the viewer's vote (member of the poll's conversation only). */
export async function votePoll(pollId: string, viewerId: string, optionIndex: number): Promise<{ ok: boolean }> {
  try {
    const db = createAdminClient();
    const { data: poll } = await db.from("message_polls").select("conversation_id, options").eq("id", pollId).maybeSingle();
    if (!poll) return { ok: false };
    const options = poll.options as string[];
    if (optionIndex < 0 || optionIndex >= options.length) return { ok: false };
    const role = await memberRole(db, poll.conversation_id as string, viewerId);
    if (!role) return { ok: false };
    const { error } = await db
      .from("message_poll_votes")
      .upsert({ poll_id: pollId, conversation_id: poll.conversation_id, user_id: viewerId, option_index: optionIndex }, { onConflict: "poll_id,user_id" });
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}

/**
 * Demote-then-promote as ONE atomic transaction (a `security definer` SQL
 * function, see migration 0041) rather than two separate JS-orchestrated
 * UPDATEs — the previous two-step version could leave a group with zero
 * owners (and no recovery path, since transferring ownership itself
 * requires an existing owner) if the second update failed and the
 * best-effort rollback also failed.
 */
export async function transferOwnership(
  conversationId: string,
  actorId: string,
  newOwnerId: string,
): Promise<{ ok: boolean; reason?: string }> {
  if (actorId === newOwnerId) return { ok: false, reason: "invalid" };
  try {
    const db = createAdminClient();
    const { data, error } = await db.rpc("transfer_group_ownership", {
      p_conversation_id: conversationId,
      p_actor_id: actorId,
      p_new_owner_id: newOwnerId,
    });
    if (error) return { ok: false };
    return { ok: data === true, reason: data === true ? undefined : "forbidden" };
  } catch {
    return { ok: false };
  }
}

export async function setMemberRole(
  conversationId: string,
  actorId: string,
  targetUserId: string,
  role: "admin" | "member",
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const db = createAdminClient();
    const actorRole = await memberRole(db, conversationId, actorId);
    if (actorRole !== "owner") return { ok: false, reason: "forbidden" };
    const targetRole = await memberRole(db, conversationId, targetUserId);
    if (!targetRole || targetRole === "owner") return { ok: false, reason: "invalid_target" };
    const { error } = await db.from("conversation_members").update({ role }).eq("conversation_id", conversationId).eq("user_id", targetUserId);
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}

/** Self-only: mute/archive/pin a conversation from your own inbox. */
export async function setConversationPrefs(
  userId: string,
  conversationId: string,
  patch: Partial<{ muted: boolean; archived: boolean; pinned: boolean; hidden: boolean }>,
): Promise<{ ok: boolean }> {
  try {
    const db = createAdminClient();
    const clean: Record<string, boolean | string | null> = {};
    if (typeof patch.muted === "boolean") clean.muted = patch.muted;
    if (typeof patch.archived === "boolean") clean.archived = patch.archived;
    if (typeof patch.pinned === "boolean") clean.pinned = patch.pinned;
    // Per-user "Delete conversation" (swipe action) — a soft hide, not a
    // destructive delete of shared data. `hidden_at` reset to null un-hides;
    // `listConversations` auto-reveals it again anyway once new activity
    // lands, but an explicit un-hide (if ever exposed) should work too.
    if (typeof patch.hidden === "boolean") clean.hidden_at = patch.hidden ? new Date().toISOString() : null;
    if (Object.keys(clean).length === 0) return { ok: true };
    const { error } = await db
      .from("conversation_members")
      .update(clean)
      .eq("conversation_id", conversationId)
      .eq("user_id", userId)
      .is("left_at", null);
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}

/**
 * Fire-and-forget: notify every other active member that a message landed —
 * `message_mention` instead of the generic `message` type for anyone the
 * text @mentions, so it's the one place a message's notification row is
 * ever created and a mentioned member never gets BOTH a generic and a
 * mention row for the same send. Returns the mentioned user ids so the
 * caller (the API route, which owns push-sending) can word/prioritize their
 * push differently too.
 */
async function notifyMembers(db: Db, conversationId: string, senderId: string, messageId: string, body: string): Promise<string[]> {
  try {
    const { data: members } = await db
      .from("conversation_members")
      .select("user_id")
      .eq("conversation_id", conversationId)
      .is("left_at", null)
      .neq("user_id", senderId);
    const recipients = (members ?? []) as { user_id: string }[];
    if (recipients.length === 0) return [];

    const mentionedHandles = parseMentionedHandles(body);
    let mentionedUserIds = new Set<string>();
    if (mentionedHandles.length > 0) {
      const { data: profs } = await db
        .from("profiles")
        .select("id, handle")
        .in(
          "id",
          recipients.map((r) => r.user_id),
        );
      const idByHandle = new Map(((profs ?? []) as { id: string; handle: string | null }[]).filter((p) => p.handle).map((p) => [p.handle!.toLowerCase(), p.id]));
      mentionedUserIds = new Set(mentionedHandles.map((h) => idByHandle.get(h)).filter((id): id is string => !!id));
    }

    const rows = recipients.map((m) => ({
      user_id: m.user_id,
      actor_id: senderId,
      type: mentionedUserIds.has(m.user_id) ? "message_mention" : "message",
      conversation_id: conversationId,
      message_id: messageId,
    }));
    await db.from("notifications").insert(rows);
    return [...mentionedUserIds];
  } catch {
    /* notifications are best-effort */
    return [];
  }
}

export interface AttachmentInput {
  mediaKind: AttachmentKind;
  mediaUrl: string;
  thumbnailUrl?: string;
  mediaWidth?: number;
  mediaHeight?: number;
  durationMs?: number;
  waveform?: number[];
  filename?: string;
  mimeType?: string;
  sizeBytes?: number;
}

export interface SendMessageOptions {
  replyToId?: string;
  /** Already-uploaded media (image/video/voice/document) — the client
   * uploads bytes directly to R2/Storage first (same presign+PUT pipeline
   * posts use), then hands over just the resulting URL(s); this function
   * never touches raw bytes. Empty text + at least one attachment is valid
   * (an attachment-only message, same as every other chat app). */
  attachments?: AttachmentInput[];
  /** Idempotency key: a client-generated UUID. Replaying the same send (an
   * offline-queue retry racing a delayed success, e.g.) returns the
   * ALREADY-created message instead of inserting a duplicate. */
  clientId?: string;
  /** Client-side send timestamp — purely a latency metric (server
   * `created_at` stays the sole ordering/delivery authority). */
  clientSentAt?: string;
  /** Set when this send is a forward of an existing message. */
  forwardedFromId?: string;
  /** Secret Chats only (Part 11b): the AES-GCM nonce for this message —
   *  `body` must already be base64 ciphertext when this is set. Never
   *  generated/interpreted server-side; this function just stores it. */
  encryptionIv?: string;
  /** Location/Contact share payload (inbox mockup completion) — neither fits
   *  `message_attachments` (media-file-shaped), so a small structured JSON
   *  column instead. See migration 0070's header for the exact shapes. */
  metadata?: Record<string, unknown>;
}

/**
 * Send a message in an existing conversation (sender must be an active
 * member). Idempotent when `clientId` is supplied: a second call with the
 * same (conversationId, senderId, clientId) returns the original insert's
 * id rather than creating a duplicate — safe to call from an offline-queue
 * replay without a duplicate-detection dance at the call site.
 */
export async function sendMessage(
  senderId: string,
  conversationId: string,
  body: string,
  options: SendMessageOptions = {},
): Promise<{ ok: true; id: string; duplicate?: boolean } | { ok: false; reason?: string }> {
  if (!hasSupabase) return { ok: false };
  const text = body.trim();
  const attachments = (options.attachments ?? []).slice(0, MAX_ATTACHMENTS_PER_MESSAGE);
  // Base64-encoded AES-GCM ciphertext runs ~33% longer than the plaintext it
  // came from (plus a fixed 16-byte GCM auth tag) — a higher cap here, not a
  // separate code path, keeps this one length guard correct for both.
  const maxLen = options.encryptionIv ? 2800 : 2000;
  if (text.length > maxLen) return { ok: false };
  if (!text && attachments.length === 0 && !options.metadata) return { ok: false }; // attachment-only / location-only / contact-only sends are valid; a truly empty send isn't
  try {
    const db = createAdminClient();
    const { data: conv } = await db
      .from("conversations")
      .select("id, type, user_low, user_high, only_admins_can_send")
      .eq("id", conversationId)
      .maybeSingle();
    if (!conv) return { ok: false };

    // Secret Chats: text only in v1 — real client-side media encryption
    // (encrypt the file before it ever reaches R2) is a real, buildable
    // extension but out of scope this round; reject rather than silently
    // uploading an unencrypted attachment into an otherwise-encrypted thread.
    if (conv.type === "secret" && attachments.length > 0) return { ok: false, reason: "secret_media_unsupported" };
    if (conv.type === "secret" && !options.encryptionIv) return { ok: false, reason: "secret_requires_encryption" };

    const { data: membership } = await db
      .from("conversation_members")
      .select("user_id, role")
      .eq("conversation_id", conversationId)
      .eq("user_id", senderId)
      .is("left_at", null)
      .maybeSingle();
    if (!membership) return { ok: false };

    if (conv.type === "group" && conv.only_admins_can_send && membership.role === "member") {
      return { ok: false, reason: "admins_only" };
    }

    if (conv.type === "direct" || conv.type === "secret") {
      const other = conv.user_low === senderId ? (conv.user_high as string | null) : (conv.user_low as string | null);
      if (other && (await bothBlocked(db, senderId, other))) return { ok: false };
    }

    // Idempotency check FIRST — a replayed send should never even attempt a
    // second insert (avoids relying solely on the unique-index error path).
    if (options.clientId) {
      const { data: existing } = await db
        .from("messages")
        .select("id")
        .eq("conversation_id", conversationId)
        .eq("sender_id", senderId)
        .eq("client_id", options.clientId)
        .maybeSingle();
      if (existing) return { ok: true, id: existing.id as string, duplicate: true };
    }

    let replyTo: string | null = null;
    if (options.replyToId) {
      const { data: parent } = await db
        .from("messages")
        .select("id")
        .eq("id", options.replyToId)
        .eq("conversation_id", conversationId)
        .maybeSingle();
      if (parent) replyTo = parent.id as string;
    }

    let forwardedFrom: string | null = null;
    if (options.forwardedFromId) {
      const { data: origin } = await db.from("messages").select("id").eq("id", options.forwardedFromId).maybeSingle();
      if (origin) forwardedFrom = origin.id as string;
    }

    const { data: inserted, error } = await db
      .from("messages")
      .insert({
        conversation_id: conversationId,
        sender_id: senderId,
        body: text,
        reply_to_id: replyTo,
        client_id: options.clientId ?? null,
        client_sent_at: options.clientSentAt ?? null,
        forwarded_from_id: forwardedFrom,
        encryption_iv: options.encryptionIv ?? null,
        metadata: options.metadata ?? null,
      })
      .select("id")
      .single();
    if (error || !inserted) {
      // Lost a race on the (conversation, sender, client_id) unique index —
      // the concurrent winner already landed; return its id, not a failure.
      if (options.clientId) {
        const { data: winner } = await db
          .from("messages")
          .select("id")
          .eq("conversation_id", conversationId)
          .eq("sender_id", senderId)
          .eq("client_id", options.clientId)
          .maybeSingle();
        if (winner) return { ok: true, id: winner.id as string, duplicate: true };
      }
      return { ok: false };
    }

    if (attachments.length > 0) {
      const { error: attachErr } = await db.from("message_attachments").insert(
        attachments.map((a, idx) => ({
          message_id: inserted.id,
          conversation_id: conversationId,
          idx,
          media_kind: a.mediaKind,
          media_url: a.mediaUrl,
          thumbnail_url: a.thumbnailUrl ?? null,
          media_width: a.mediaWidth ?? null,
          media_height: a.mediaHeight ?? null,
          duration_ms: a.durationMs ?? null,
          waveform: a.waveform ?? null,
          filename: a.filename ?? null,
          mime_type: a.mimeType ?? null,
          size_bytes: a.sizeBytes ?? null,
        })),
      );
      // The message itself already landed — an attachment-row failure
      // shouldn't silently vanish the whole send, but it does mean the
      // recipient sees a text-only (or empty) bubble instead of the media.
      // Best-effort logged the same way a send failure is elsewhere; not
      // worth a full transaction/rollback for what's fundamentally a
      // metadata-row insert after the real bytes are already safely stored.
      if (attachErr) {
        try {
          await db.from("message_send_failures").insert({
            user_id: senderId,
            conversation_id: conversationId,
            client_id: options.clientId ?? null,
            reason: "attachment_insert_failed",
            attempts: 1,
          });
        } catch {
          /* best-effort telemetry only */
        }
      }
    }

    // `after()`, not a bare `void` — a fire-and-forget call started right
    // before a serverless Route Handler returns its response isn't
    // guaranteed to finish; Vercel can freeze the function the moment the
    // response is sent, silently deferring (or dropping) whatever was still
    // in flight until some unrelated later request happens to reuse the same
    // warm instance. That's the actual explanation for "push notifications
    // arrive minutes late" — found 2026-07-12 chasing that report. `after()`
    // keeps the function alive until this specific work finishes.
    after(() => notifyMembers(db, conversationId, senderId, inserted.id as string, text));

    return { ok: true, id: inserted.id as string };
  } catch {
    return { ok: false };
  }
}

/**
 * Forward an existing message's text into one or more conversations the
 * sender is already an active member of (direct or group — unlike Share,
 * which only ever fans out to new/existing 1:1 threads, Forward can target
 * a group you're in too). Each target gets its own real `sendMessage` call
 * with `forwardedFromId` set, so it participates fully in the normal
 * delivery/notification pipeline rather than being a special case.
 */
export async function forwardMessage(
  senderId: string,
  messageId: string,
  toConversationIds: string[],
): Promise<{ ok: boolean; sent: number }> {
  try {
    const db = createAdminClient();
    const { data: source } = await db.from("messages").select("body, conversation_id, deleted_at, metadata").eq("id", messageId).maybeSingle();
    if (!source || source.deleted_at) return { ok: false, sent: 0 };

    // Secret Chats: "No Forwarding" (spec). Ciphertext forwarded into a
    // different conversation is meaningless anyway (wrong recipient key),
    // but block it explicitly rather than silently sending garbage.
    const { data: sourceConv } = await db.from("conversations").select("type").eq("id", source.conversation_id).maybeSingle();
    if (sourceConv?.type === "secret") return { ok: false, sent: 0 };

    // The forwarder must actually be able to see the source message.
    const { data: sourceMembership } = await db
      .from("conversation_members")
      .select("user_id")
      .eq("conversation_id", source.conversation_id)
      .eq("user_id", senderId)
      .is("left_at", null)
      .maybeSingle();
    if (!sourceMembership) return { ok: false, sent: 0 };

    const targets = [...new Set(toConversationIds)].slice(0, 20);
    const { data: targetConvs } = targets.length
      ? await db.from("conversations").select("id, type").in("id", targets)
      : { data: [] as { id: string; type: string }[] };
    const secretTargetIds = new Set(
      ((targetConvs ?? []) as { id: string; type: string }[]).filter((c) => c.type === "secret").map((c) => c.id),
    );

    // Location/Contact metadata forwards verbatim (re-sharing the same
    // coordinates/contact into a new conversation is meaningful there). A
    // Poll does NOT — its vote-tracking row is scoped to the ORIGINAL
    // conversation's membership (see votePoll/getPollResults), so forwarding
    // the same pollId into a different conversation would silently 403 for
    // anyone there who isn't also a member of the source thread. Falling
    // back to no metadata (same as an ordinary empty-body forward) keeps
    // this an honest no-op rather than a half-working cross-conversation
    // reference.
    const sourceMetadata = source.metadata as Record<string, unknown> | null;
    const forwardMetadata = sourceMetadata?.kind === "poll" ? undefined : (sourceMetadata ?? undefined);

    let sent = 0;
    for (const conversationId of targets) {
      if (secretTargetIds.has(conversationId)) continue; // can't forward plaintext into an encrypted thread
      const res = await sendMessage(senderId, conversationId, source.body as string, {
        forwardedFromId: messageId,
        metadata: forwardMetadata,
      });
      if (res.ok && !res.duplicate) sent += 1;
    }
    return { ok: sent > 0, sent };
  } catch {
    return { ok: false, sent: 0 };
  }
}

/** Sender-only: edit a message's text (no time cutoff). */
export async function editMessage(userId: string, messageId: string, body: string): Promise<{ ok: boolean; reason?: string }> {
  const text = body.trim();
  if (!text || text.length > 2000) return { ok: false, reason: "invalid" };
  try {
    const db = createAdminClient();
    const { data: msg } = await db.from("messages").select("sender_id, deleted_at, encryption_iv").eq("id", messageId).maybeSingle();
    if (!msg) return { ok: false, reason: "not_found" };
    if (msg.sender_id !== userId) return { ok: false, reason: "forbidden" };
    if (msg.deleted_at) return { ok: false, reason: "deleted" };
    // Secret Chats: editing would need the client to re-encrypt with a new
    // nonce (this function only ever takes plaintext) — out of scope for
    // v1, so a Secret Chat message can be deleted but not edited.
    if (msg.encryption_iv) return { ok: false, reason: "secret_edit_unsupported" };
    const { error } = await db.from("messages").update({ body: text, edited_at: new Date().toISOString() }).eq("id", messageId);
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}

/** Sender-only soft-delete (direct or group) — no moderator-delete in Part 1. */
export async function deleteMessage(userId: string, messageId: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    const db = createAdminClient();
    const { data: msg } = await db.from("messages").select("sender_id, deleted_at").eq("id", messageId).maybeSingle();
    if (!msg) return { ok: false, reason: "not_found" };
    if (msg.sender_id !== userId) return { ok: false, reason: "forbidden" };
    if (msg.deleted_at) return { ok: true }; // already deleted — idempotent
    const { error } = await db
      .from("messages")
      .update({ body: "", deleted_at: new Date().toISOString(), pinned: false, pinned_at: null, pinned_by: null })
      .eq("id", messageId);
    if (error) return { ok: false };
    db.from("message_reactions").delete().eq("message_id", messageId).then(undefined, () => {});
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** Any active member can pin/unpin (WhatsApp/Telegram-style, not owner-only). */
export async function setMessagePinned(userId: string, messageId: string, pinned: boolean): Promise<{ ok: boolean; reason?: string }> {
  try {
    const db = createAdminClient();
    const { data: msg } = await db.from("messages").select("conversation_id, deleted_at").eq("id", messageId).maybeSingle();
    if (!msg || msg.deleted_at) return { ok: false, reason: "not_found" };
    const { data: membership } = await db
      .from("conversation_members")
      .select("user_id")
      .eq("conversation_id", msg.conversation_id)
      .eq("user_id", userId)
      .is("left_at", null)
      .maybeSingle();
    if (!membership) return { ok: false, reason: "forbidden" };
    const patch = pinned
      ? { pinned: true, pinned_at: new Date().toISOString(), pinned_by: userId }
      : { pinned: false, pinned_at: null, pinned_by: null };
    const { error } = await db.from("messages").update(patch).eq("id", messageId);
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}

/** Kinds the inbox preview can label. `file` covers documents and anything
 *  else that isn't image/video/audio. */
export type LastMessageKind = "location" | "contact" | "poll" | "image" | "video" | "audio" | "file" | null;

export interface ConversationSummary {
  id: string;
  type: ConversationType;
  /** Group display name (null for direct — use `other` instead). */
  title: string | null;
  /** Group avatar (null for direct — use `other.avatarUrl` instead). */
  avatarUrl: string | null;
  /** The other participant — direct conversations only. */
  other: OtherUser | null;
  memberCount: number;
  lastBody: string | null;
  /** What the last message WAS, so the inbox row can render a real icon +
   *  label instead of a bare tick. Metadata kinds (location/contact/poll) come
   *  from migration 0074's `last_message_kind`; the media kinds are resolved
   *  from the newest attachment when the last message carried no text (the
   *  preview trigger can't see attachments — see listConversations). Null for a
   *  plain text message, which shows its own text. */
  lastMessageKind: LastMessageKind;
  lastAt: string;
  fromMe: boolean;
  /**
   * Delivery state of YOUR OWN last message, so the inbox shows it without
   * anyone opening the chat (owner, 2026-07-16: "just like whatsapp ... they
   * just see it outside and go to the next"). Null when the last message wasn't
   * yours, or when there's nothing honest to show.
   *
   * Direct threads only — groups have no per-message read state at all (they
   * use a per-member `last_read_at` cursor), so a "seen" tick there would be a
   * claim the data can't support.
   *
   * "seen" is SUPPRESSED when the other person has turned read receipts off —
   * showing it anyway would leak exactly what that toggle exists to hide. Such
   * a message reports "delivered" instead, which is still true.
   */
  lastStatus: "sent" | "delivered" | "seen" | null;
  unread: boolean;
  unreadCount: number;
  muted: boolean;
  archived: boolean;
  pinned: boolean;
}

/**
 * Per-conversation unread counts for the inbox. Direct threads use the exact
 * current message-level `read_at is null` semantics (unchanged); group
 * threads have no per-message-per-member receipt (would explode row count —
 * see the migration's own D4 note), so a group message counts as unread if
 * it's newer than the viewer's own `last_read_at` cursor for that
 * conversation (or the viewer has never opened it at all, i.e. no cursor).
 * Pure/exported so it's unit-testable without a DB.
 */
export function countUnread(
  directUnreadRows: { conversation_id: string }[],
  groupCandidateRows: { conversation_id: string; created_at: string }[],
  lastReadByGroup: Map<string, string | null>,
): Map<string, number> {
  const unreadByConv = new Map<string, number>();
  for (const u of directUnreadRows) {
    unreadByConv.set(u.conversation_id, (unreadByConv.get(u.conversation_id) ?? 0) + 1);
  }
  for (const m of groupCandidateRows) {
    const cursor = lastReadByGroup.get(m.conversation_id);
    if (!cursor || m.created_at > cursor) {
      unreadByConv.set(m.conversation_id, (unreadByConv.get(m.conversation_id) ?? 0) + 1);
    }
  }
  return unreadByConv;
}

/** A user's inbox, pinned first then newest. */
export async function listConversations(userId: string): Promise<ConversationSummary[]> {
  if (!hasSupabase) return [];
  try {
    const db = createAdminClient();
    const { data: memberships } = await db
      .from("conversation_members")
      .select("conversation_id, muted, archived, pinned, hidden_at")
      .eq("user_id", userId)
      .is("left_at", null)
      .limit(200);
    const mrows = (memberships ?? []) as { conversation_id: string; muted: boolean; archived: boolean; pinned: boolean; hidden_at: string | null }[];
    if (mrows.length === 0) return [];
    const convIds = mrows.map((m) => m.conversation_id);
    const prefByConv = new Map(mrows.map((m) => [m.conversation_id, m]));

    const { data: convRows } = await db
      .from("conversations")
      .select("id, type, title, avatar_url, user_low, user_high, last_body, last_sender_id, last_message_at")
      .in("id", convIds)
      // Secret Chats (Part 11b) are deliberately excluded from the normal
      // inbox — they only ever appear behind the separate, PIN/passkey-
      // gated Secret Chats panel (see listSecretConversations below).
      .neq("type", "secret");
    const convs = (convRows ?? []) as {
      id: string;
      type: ConversationType;
      title: string | null;
      avatar_url: string | null;
      user_low: string | null;
      user_high: string | null;
      last_body: string | null;
      last_sender_id: string | null;
      last_message_at: string;
    }[];
    if (convs.length === 0) return [];

    // Best-effort, separate from the main SELECT above (migration 0074) —
    // same reasoning as getConversation()'s wallpaper_url fetch: a column
    // the DB migration hasn't landed yet must never fail the WHOLE inbox
    // query, just leave this one field null.
    let kindByConv = new Map<string, LastMessageKind>();
    try {
      const { data: kindRows } = await db.from("conversations").select("id, last_message_kind").in("id", convIds);
      kindByConv = new Map(
        ((kindRows ?? []) as { id: string; last_message_kind: LastMessageKind }[]).map((r) => [r.id, r.last_message_kind]),
      );
    } catch {
      /* migration not applied yet — rows just render without the icon */
    }

    // Attachment previews (owner, 2026-07-16: "include video when a video is
    // sent, and image when image is sent, and audio when audio is sent last,
    // and location when location is sent last, or if is a text chat the first 4
    // or 3 words").
    //
    // `conversations.last_message_kind` only ever carries the METADATA kinds
    // (location/contact/poll) — it's set by the `sync_conversation_preview()`
    // trigger, which fires on the message INSERT, and attachment rows land in a
    // SEPARATE insert straight after. The trigger literally cannot see them.
    // So an attachment-only message left `last_body` empty and no kind at all,
    // and the inbox row rendered a bare tick — exactly what the owner's
    // screenshot shows.
    //
    // Resolved here instead of with another trigger: one extra query for the
    // whole inbox, no schema change, and no second place for the preview to
    // drift out of sync with the messages table.
    const attachmentKindByConv = new Map<string, LastMessageKind>();
    try {
      const { data: attRows } = await db
        .from("message_attachments")
        .select("conversation_id, media_kind, created_at")
        .in("conversation_id", convIds)
        .order("created_at", { ascending: false });
      for (const r of (attRows ?? []) as { conversation_id: string; media_kind: string }[]) {
        // Rows arrive newest-first, so the first one per conversation is the
        // most recent attachment — keep it and ignore the rest.
        if (attachmentKindByConv.has(r.conversation_id)) continue;
        const k = r.media_kind;
        attachmentKindByConv.set(
          r.conversation_id,
          k === "image" || k === "video" || k === "audio" ? k : "file",
        );
      }
    } catch {
      /* best-effort — rows just render without the attachment label */
    }

    /** The kind to SHOW for a row: an explicit metadata kind wins; otherwise, if
     *  the last message had no text, it was an attachment-only send and the most
     *  recent attachment is what it was. A last message WITH text keeps its text
     *  (a captioned photo reads better as its caption). */
    const previewKindFor = (id: string, lastBody: string | null): LastMessageKind => {
      const meta = kindByConv.get(id) ?? null;
      if (meta) return meta;
      if (lastBody && lastBody.trim()) return null;
      return attachmentKindByConv.get(id) ?? null;
    };

    // Receipt state of the viewer's OWN last message per conversation, so the
    // inbox can show sent/delivered/seen without opening the chat (owner,
    // 2026-07-16: "just like whatsapp ... they just see it outside and go to
    // the next").
    //
    // Direct threads only: groups have no per-message read state (they use a
    // per-member `last_read_at` cursor), so a tick there would assert something
    // the data can't back.
    //
    // The PRIVACY half is not optional. "Seen" must be suppressed when the
    // other person has read receipts off — surfacing it in the inbox would leak
    // precisely what that toggle exists to hide, and would be a worse leak than
    // the thread's, because it's visible at a glance across every chat. The
    // thread already suppresses it (see getConversation's
    // `otherReadReceiptsEnabled`); this mirrors that rule rather than inventing
    // a second one.
    const statusByConv = new Map<string, "sent" | "delivered" | "seen">();
    try {
      const directIds = convs.filter((c) => c.type === "direct").map((c) => c.id);
      if (directIds.length > 0) {
        const otherIdOf = (c: (typeof convs)[number]) => (c.user_low === userId ? c.user_high : c.user_low);
        const otherIds = [
          ...new Set(convs.filter((c) => c.type === "direct").map(otherIdOf).filter((x): x is string => !!x)),
        ];
        const [{ data: lastRows }, { data: privRows }] = await Promise.all([
          db
            .from("messages")
            .select("conversation_id, sender_id, delivered_at, read_at, created_at")
            .in("conversation_id", directIds)
            .order("created_at", { ascending: false })
            .limit(600),
          otherIds.length
            ? db.from("privacy_settings").select("user_id, read_receipts_enabled").in("user_id", otherIds)
            : Promise.resolve({ data: [] as { user_id: string; read_receipts_enabled: boolean | null }[] }),
        ]);
        const receiptsOff = new Set(
          ((privRows ?? []) as { user_id: string; read_receipts_enabled: boolean | null }[])
            .filter((p) => p.read_receipts_enabled === false)
            .map((p) => p.user_id),
        );
        const seenConv = new Set<string>();
        for (const r of (lastRows ?? []) as {
          conversation_id: string;
          sender_id: string;
          delivered_at: string | null;
          read_at: string | null;
        }[]) {
          // Rows are newest-first, so the first per conversation IS the last
          // message. Everything after it is history.
          if (seenConv.has(r.conversation_id)) continue;
          seenConv.add(r.conversation_id);
          if (r.sender_id !== userId) continue; // only YOUR message carries ticks
          const conv = convs.find((c) => c.id === r.conversation_id);
          const otherId = conv ? otherIdOf(conv) : null;
          const canShowSeen = !otherId || !receiptsOff.has(otherId);
          statusByConv.set(
            r.conversation_id,
            r.read_at && canShowSeen ? "seen" : r.read_at || r.delivered_at ? "delivered" : "sent",
          );
        }
      }
    } catch {
      /* best-effort — rows just render without a tick */
    }

    const directConvs = convs.filter((c) => c.type === "direct");
    const groupConvs = convs.filter((c) => c.type === "group");
    const directConvIds = directConvs.map((c) => c.id);
    const groupConvIds = groupConvs.map((c) => c.id);
    const directOtherIds = directConvs
      .map((c) => (c.user_low === userId ? c.user_high : c.user_low))
      .filter((id): id is string => !!id);

    const [{ data: profs }, { data: directUnread }, { data: groupUnread }, { data: groupMembers }, friends] = await Promise.all([
      directOtherIds.length
        ? db.from("profiles").select("id, handle, display_name, avatar_url, is_verified, is_suspended, is_hidden").in("id", directOtherIds)
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
      directConvIds.length
        ? db
            .from("messages")
            .select("conversation_id")
            .in("conversation_id", directConvIds)
            .neq("sender_id", userId)
            .is("read_at", null)
            .is("deleted_at", null)
        : Promise.resolve({ data: [] as { conversation_id: string }[] }),
      // Groups have no per-message read_at — fetch the candidate set and
      // count against each conversation's own last_read_at cursor below.
      groupConvIds.length
        ? db
            .from("messages")
            .select("conversation_id, created_at")
            .in("conversation_id", groupConvIds)
            .neq("sender_id", userId)
            .is("deleted_at", null)
            .order("created_at", { ascending: false })
            .limit(1000)
        : Promise.resolve({ data: [] as { conversation_id: string; created_at: string }[] }),
      groupConvIds.length
        ? db.from("conversation_members").select("conversation_id").in("conversation_id", groupConvIds).is("left_at", null)
        : Promise.resolve({ data: [] as { conversation_id: string }[] }),
      // In the batch, not after it: it only needs `userId`, so awaiting it
      // separately (as it was when 0082 added it) put an extra sequential round
      // trip on the INBOX's critical path — the page the owner watches most.
      // Owner's 2-second page budget: see [[rule-2-second-page-budget]].
      friendIdSet(userId),
    ]);

    // Group unread cursor: need each group's OWN last_read_at, which isn't in
    // `memberships` above (kept lean for the common direct case) — fetch it
    // only for the groups we actually have.
    let lastReadByGroup = new Map<string, string | null>();
    if (groupConvIds.length) {
      const { data: cursorRows } = await db
        .from("conversation_members")
        .select("conversation_id, last_read_at")
        .eq("user_id", userId)
        .in("conversation_id", groupConvIds);
      lastReadByGroup = new Map(
        ((cursorRows ?? []) as { conversation_id: string; last_read_at: string | null }[]).map((r) => [r.conversation_id, r.last_read_at]),
      );
    }

    const profById = new Map(((profs ?? []) as Record<string, unknown>[]).map((p) => [p.id as string, p]));

    const unreadByConv = countUnread(
      (directUnread ?? []) as { conversation_id: string }[],
      (groupUnread ?? []) as { conversation_id: string; created_at: string }[],
      lastReadByGroup,
    );
    const memberCountByGroup = new Map<string, number>();
    for (const g of (groupMembers ?? []) as { conversation_id: string }[]) {
      memberCountByGroup.set(g.conversation_id, (memberCountByGroup.get(g.conversation_id) ?? 0) + 1);
    }

    // Fetching the inbox = the recipient's app has the direct messages →
    // mark them delivered (fire-and-forget). Drives the sender's "Delivered"
    // receipt. Unchanged from before — direct-only, groups use last_read_at.
    // `.then()` is load-bearing, not decoration — Supabase's query builder is
    // a lazy thenable; a bare `void` with no `.then()`/`await` anywhere in
    // the chain never actually sends the request (verified empirically this
    // round). This UPDATE had silently never been firing.
    if (directConvIds.length) {
      db.from("messages")
        .update({ delivered_at: new Date().toISOString() })
        .in("conversation_id", directConvIds)
        .neq("sender_id", userId)
        .is("delivered_at", null)
        .then(undefined, () => {});
    }

    // NOTE: `friends` (from the batch above) is the account-visibility friend set
    // (migration 0082, "hidden = friends-only"), unrelated to the
    // per-conversation `hidden_at` pref just below — which is the user's own
    // "Delete" swipe. Same word, two completely different features.
    const out: ConversationSummary[] = [];
    for (const c of convs) {
      const pref = prefByConv.get(c.id);
      // A hidden conversation ("Delete" from the swipe actions) auto-reappears
      // the instant new activity lands — checked here as "does the LATEST
      // message post-date the hide" rather than a one-way flag, so nothing
      // ever gets silently and permanently lost the way a real delete would.
      if (pref?.hidden_at && new Date(pref.hidden_at) >= new Date(c.last_message_at)) continue;
      if (c.type === "direct") {
        const otherId = c.user_low === userId ? c.user_high : c.user_low;
        const p = otherId ? profById.get(otherId) : null;
        if (!otherId || !p || !p.handle) continue;
        // A hidden friend's chat stays right where it is (migration 0082) — the
        // inbox is friends-only by nature, so a hide must not empty it. Only a
        // suspension, or a hidden account the viewer never befriended, drops out.
        if (!isAccountVisibleTo(flagsOf(p), relationTo(otherId, userId, friends))) continue;
        out.push({
          id: c.id,
          type: "direct",
          title: null,
          avatarUrl: null,
          other: {
            id: otherId,
            handle: p.handle as string,
            displayName: (p.display_name as string) || `@${p.handle as string}`,
            avatarUrl: (p.avatar_url as string) ?? null,
            isVerified: (p.is_verified as boolean) ?? false,
          },
          memberCount: 2,
          lastBody: c.last_body,
          lastMessageKind: previewKindFor(c.id, c.last_body),
          lastStatus: statusByConv.get(c.id) ?? null,
          lastAt: c.last_message_at,
          fromMe: c.last_sender_id === userId,
          unread: (unreadByConv.get(c.id) ?? 0) > 0,
          unreadCount: unreadByConv.get(c.id) ?? 0,
          muted: pref?.muted ?? false,
          archived: pref?.archived ?? false,
          pinned: pref?.pinned ?? false,
        });
      } else {
        out.push({
          id: c.id,
          type: "group",
          title: c.title,
          avatarUrl: c.avatar_url,
          other: null,
          memberCount: memberCountByGroup.get(c.id) ?? 0,
          lastBody: c.last_body,
          lastMessageKind: previewKindFor(c.id, c.last_body),
          lastStatus: statusByConv.get(c.id) ?? null,
          lastAt: c.last_message_at,
          fromMe: c.last_sender_id === userId,
          unread: (unreadByConv.get(c.id) ?? 0) > 0,
          unreadCount: unreadByConv.get(c.id) ?? 0,
          muted: pref?.muted ?? false,
          archived: pref?.archived ?? false,
          pinned: pref?.pinned ?? false,
        });
      }
    }

    out.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime();
    });
    return out.slice(0, 50);
  } catch {
    return [];
  }
}

/**
 * Secret Chats list (Part 11b) — deliberately separate from
 * `listConversations`, not a filter on it: 1:1 only, no group unread-cursor
 * complexity, and `lastBody` is ALWAYS null (the server only has
 * ciphertext — showing raw base64 as a "preview" would look broken, and
 * decrypting it here would defeat the point). The client shows a generic
 * "Encrypted message" label instead; opening the thread is what actually
 * decrypts, using the viewer's own device-local private key.
 */
export async function listSecretConversations(userId: string): Promise<ConversationSummary[]> {
  if (!hasSupabase) return [];
  try {
    const db = createAdminClient();
    const { data: memberships } = await db
      .from("conversation_members")
      .select("conversation_id, muted, archived, pinned")
      .eq("user_id", userId)
      .is("left_at", null)
      .limit(200);
    const mrows = (memberships ?? []) as { conversation_id: string; muted: boolean; archived: boolean; pinned: boolean }[];
    if (mrows.length === 0) return [];
    const convIds = mrows.map((m) => m.conversation_id);
    const prefByConv = new Map(mrows.map((m) => [m.conversation_id, m]));

    const { data: convRows } = await db
      .from("conversations")
      .select("id, user_low, user_high, last_sender_id, last_message_at")
      .in("id", convIds)
      .eq("type", "secret");
    const convs = (convRows ?? []) as {
      id: string;
      user_low: string | null;
      user_high: string | null;
      last_sender_id: string | null;
      last_message_at: string;
    }[];
    if (convs.length === 0) return [];

    const otherIds = convs.map((c) => (c.user_low === userId ? c.user_high : c.user_low)).filter((id): id is string => !!id);
    const { data: profs } = otherIds.length
      ? await db.from("profiles").select("id, handle, display_name, avatar_url, is_verified, is_suspended, is_hidden").in("id", otherIds)
      : { data: [] as Record<string, unknown>[] };
    const profById = new Map(((profs ?? []) as Record<string, unknown>[]).map((p) => [p.id as string, p]));
    const friends = await friendIdSet(userId);

    const out: ConversationSummary[] = [];
    for (const c of convs) {
      const otherId = c.user_low === userId ? c.user_high : c.user_low;
      const p = otherId ? profById.get(otherId) : null;
      if (!otherId || !p || !p.handle) continue;
      // Same rule as the main inbox: a hidden friend's secret chat survives a
      // hide (0082); only a suspension or a hidden non-friend disappears.
      if (!isAccountVisibleTo(flagsOf(p), relationTo(otherId, userId, friends))) continue;
      const pref = prefByConv.get(c.id);
      out.push({
        id: c.id,
        type: "secret",
        title: null,
        avatarUrl: null,
        other: {
          id: otherId,
          handle: p.handle as string,
          displayName: (p.display_name as string) || `@${p.handle as string}`,
          avatarUrl: (p.avatar_url as string) ?? null,
          isVerified: (p.is_verified as boolean) ?? false,
        },
        memberCount: 2,
        lastBody: null,
        lastMessageKind: null,
        lastAt: c.last_message_at,
        fromMe: c.last_sender_id === userId,
        // Same honest limitation as `unread` below: secret chats have no
        // server-visible receipt state, so there is nothing truthful to tick.
        lastStatus: null,
        // No server-visible unread state for secret chats (would need the
        // same read_at plumbing regular messages have; kept out of v1 scope
        // — see docs on this round's honest limitations).
        unread: false,
        unreadCount: 0,
        muted: pref?.muted ?? false,
        archived: pref?.archived ?? false,
        pinned: pref?.pinned ?? false,
      });
    }

    out.sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
    return out.slice(0, 50);
  } catch {
    return [];
  }
}

export interface ReplyPreview {
  id: string;
  body: string;
  senderId: string;
  deleted: boolean;
}

export interface MessageReactionSummary {
  emoji: string;
  count: number;
  mine: boolean;
}

/**
 * Collapses raw `message_reactions` rows (one per user per message) into the
 * compact `{emoji, count, mine}[]` shape the UI renders as pill buttons under
 * a bubble. Pure/exported so it's unit-testable without a DB.
 */
export function aggregateReactions(
  rows: { message_id: string; user_id: string; emoji: string }[],
  viewerId: string,
): Map<string, MessageReactionSummary[]> {
  const byMessage = new Map<string, MessageReactionSummary[]>();
  for (const r of rows) {
    const list = byMessage.get(r.message_id) ?? [];
    const existing = list.find((x) => x.emoji === r.emoji);
    if (existing) {
      existing.count += 1;
      if (r.user_id === viewerId) existing.mine = true;
    } else {
      list.push({ emoji: r.emoji, count: 1, mine: r.user_id === viewerId });
    }
    byMessage.set(r.message_id, list);
  }
  return byMessage;
}

const ATTACHMENT_COLUMNS =
  "id, message_id, media_kind, media_url, thumbnail_url, media_width, media_height, duration_ms, waveform, filename, mime_type, size_bytes";

interface RawAttachmentRow {
  id: string;
  message_id: string;
  media_kind: AttachmentKind;
  media_url: string;
  thumbnail_url: string | null;
  media_width: number | null;
  media_height: number | null;
  duration_ms: number | null;
  waveform: number[] | null;
  filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
}

/** Groups already-`idx`-ordered attachment rows per message. Pure/exported so it's unit-testable without a DB. */
export function groupAttachments(rows: RawAttachmentRow[]): Map<string, MessageAttachment[]> {
  const byMessage = new Map<string, MessageAttachment[]>();
  for (const r of rows) {
    const list = byMessage.get(r.message_id) ?? [];
    list.push({
      id: r.id,
      kind: r.media_kind,
      url: r.media_url,
      thumbnailUrl: r.thumbnail_url,
      width: r.media_width,
      height: r.media_height,
      durationMs: r.duration_ms,
      waveform: r.waveform,
      filename: r.filename,
      mimeType: r.mime_type,
      sizeBytes: r.size_bytes,
    });
    byMessage.set(r.message_id, list);
  }
  return byMessage;
}

export interface MessageAttachment {
  id: string;
  kind: AttachmentKind;
  url: string;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  waveform: number[] | null;
  filename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
}

export interface MessageItem {
  id: string;
  body: string;
  createdAt: string;
  mine: boolean;
  senderId: string;
  /** Secret Chats only (Part 11b): the AES-GCM nonce needed to decrypt
   *  `body` client-side. Null for every regular (plaintext) message. */
  encryptionIv: string | null;
  /** Receipts (for the sender's own messages, direct threads only): when the other side got/read it. */
  deliveredAt: string | null;
  readAt: string | null;
  replyTo: ReplyPreview | null;
  editedAt: string | null;
  deletedAt: string | null;
  pinned: boolean;
  reactions: MessageReactionSummary[];
  attachments: MessageAttachment[];
  /** Location/Contact share payload — see migration 0070's header. Null for
   *  every ordinary text/media message. */
  metadata: Record<string, unknown> | null;
  /** The SENDER's switch (migration 0081): may recipients reshare this
   *  message's media out to a post/reel/story? Defaults to true, including
   *  when 0081 isn't applied yet. */
  allowReshare: boolean;
}

export interface ConversationView {
  id: string;
  type: ConversationType;
  title: string | null;
  avatarUrl: string | null;
  /** The other participant — direct conversations only. */
  other: OtherUser | null;
  /** Full roster — group conversations only (empty for direct). */
  members: ConversationMember[];
  viewerRole: MemberRole | null;
  /** Group only — when true, sendMessage() rejects a plain "member" sender. */
  onlyAdminsCanSend: boolean;
  /** Disappearing messages (Part 11b) — null means off. */
  disappearAfterSeconds: number | null;
  /** Chat Themes (inbox mockup completion) — null means the app default look. */
  theme: ConversationTheme | null;
  /** Chat wallpaper (migration 0073) — a custom uploaded background picture, null means none set. */
  wallpaperUrl: string | null;
  /** The viewer's OWN personal appearance for this chat (migration 0078) — font style + bubble style/color, per-conversation. */
  appearance: ChatAppearance;
  /** Part 11b — viewer's OWN "show when I'm typing" preference; gates whether ConversationRoom broadcasts typing state at all (see use-typing.ts). */
  viewerTypingIndicatorsEnabled: boolean;
  messages: MessageItem[];
  /** Pass this back as `sinceUpdatedAt` on the next call for a delta sync. */
  syncedAt: string;
}

const MESSAGE_COLUMNS =
  "id, sender_id, body, created_at, delivered_at, read_at, reply_to_id, edited_at, deleted_at, pinned, encryption_iv, metadata";
/** `allow_reshare` arrives with migration 0081 (the sender's "can others reshare
 *  my media" switch). supabase-js fails the WHOLE select if a named column is
 *  missing, so every path tries it and falls back to the pre-0081 list — an
 *  unapplied migration must only cost the switch, never the entire thread. */
const MESSAGE_COLUMNS_WITH_RESHARE = `${MESSAGE_COLUMNS}, allow_reshare`;

/**
 * The thread's messages. Extracted from `getConversation` so it can be STARTED
 * before the roster/profile lookups and awaited after them — the two are
 * independent, and there was no reason for the biggest query on the path to
 * queue behind a profile fetch (2026-07-16 latency pass).
 *
 * Both paths keep the 42703 fallback: the delta path is what every resync uses,
 * so covering only the full path would leave the reshare switch silently broken
 * on exactly the hot path.
 */
async function fetchMessageRows(
  db: ReturnType<typeof createAdminClient>,
  conversationId: string,
  sinceUpdatedAt?: string,
): Promise<RawMessageRow[]> {
  if (sinceUpdatedAt) {
    // Delta path — small, order doesn't matter (the client merges by id into
    // its own already-ordered state), so no need to reverse.
    const attempt = await db
      .from("messages")
      .select(MESSAGE_COLUMNS_WITH_RESHARE)
      .eq("conversation_id", conversationId)
      .gt("updated_at", sinceUpdatedAt)
      .order("created_at", { ascending: true })
      .limit(500);
    let delta: unknown = attempt.data;
    if (attempt.error?.code === "42703") {
      const legacy = await db
        .from("messages")
        .select(MESSAGE_COLUMNS)
        .eq("conversation_id", conversationId)
        .gt("updated_at", sinceUpdatedAt)
        .order("created_at", { ascending: true })
        .limit(500);
      delta = legacy.data;
    }
    return (delta as RawMessageRow[] | null) ?? [];
  }

  // Full path — most-recent 300, then reversed back to oldest-first for
  // display. A plain ascending order+limit (the pre-existing pre-Part-1 shape
  // of this query) returns the OLDEST 300 messages once a thread passes that
  // size, permanently hiding the actual recent conversation behind ancient
  // history. Groups make this materially worse (more senders → faster
  // accumulation).
  const attempt = await db
    .from("messages")
    .select(MESSAGE_COLUMNS_WITH_RESHARE)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(300);
  let msgsDesc: unknown = attempt.data;
  if (attempt.error?.code === "42703") {
    const legacy = await db
      .from("messages")
      .select(MESSAGE_COLUMNS)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(300);
    msgsDesc = legacy.data;
  }
  return ((msgsDesc as RawMessageRow[] | null) ?? []).slice().reverse();
}

interface RawMessageRow {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
  delivered_at: string | null;
  read_at: string | null;
  reply_to_id: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  pinned: boolean;
  encryption_iv: string | null;
  metadata: Record<string, unknown> | null;
  /** Migration 0081 — absent on a row read before it's applied. */
  allow_reshare?: boolean | null;
}

/**
 * Full thread for an active member; marks read (direct) or advances the
 * read cursor (group).
 *
 * `sinceUpdatedAt`, when supplied, turns this into a DELTA sync: instead of
 * the last 300 messages, only rows whose `updated_at` changed after that
 * timestamp come back (new sends, edits, deletes, receipts, or a reaction
 * on an older message — `updated_at` is touched by triggers for all of
 * these, see migration 0043). The client already holds everything older;
 * this just merges what moved. Falls back to the full last-300 window when
 * omitted (first load, or a client with no prior snapshot to diff against).
 */
export async function getConversation(
  conversationId: string,
  userId: string,
  sinceUpdatedAt?: string,
  /**
   * Reading a thread normally MEANS opening it, so this function marks the
   * other side's messages read as a side effect (below). `peek: true` reads the
   * thread WITHOUT making that claim.
   *
   * It exists for the inbox warm-up (owner, 2026-07-16: "chats should load one
   * after the other ... so they warm up immediately the inbox page is opened").
   * A previous warm-up was deleted precisely because it went through the normal
   * path and silently marked EVERY conversation read just from opening the
   * inbox — the sender saw "Seen" on a message the recipient had never looked
   * at, which defeats the read-receipts toggle. Warming must never be able to
   * lie about that, so the opt-out is an explicit argument here rather than a
   * convention the caller is trusted to remember.
   */
  options?: { peek?: boolean },
): Promise<ConversationView | null> {
  if (!hasSupabase) return null;
  try {
    const db = createAdminClient();

    // Everything in this block is INDEPENDENT — none of these three lookups
    // needs another's result — so they go out together rather than one at a
    // time.
    //
    // Measured 2026-07-16: the thread page took 2.3-2.5s to render server-side,
    // and it was stacked latency, not slow SQL. `getConversation` ran SIX
    // sequential awaits before the messages query even started; against remote
    // Supabase each round trip is ~250ms, so the waterfall alone accounted for
    // most of the wait the owner reports as "it loads every time I enter a
    // chat". Issuing the independent ones concurrently collapses that.
    //
    // The wallpaper/appearance queries below are still SEPARATE from this
    // conversation SELECT on purpose — see their own notes: folding a column
    // that a not-yet-applied migration lacks would fail the whole select and
    // 404 every thread. Running them in parallel keeps that guarantee and
    // removes the cost.
    const convQuery = db
      .from("conversations")
      .select("id, type, title, avatar_url, user_low, user_high, only_admins_can_send, disappear_after_seconds, theme")
      .eq("id", conversationId)
      .maybeSingle();
    const membershipQuery = db
      .from("conversation_members")
      .select("role")
      .eq("conversation_id", conversationId)
      .eq("user_id", userId)
      .is("left_at", null)
      .maybeSingle();
    const wallpaperQuery = db.from("conversations").select("wallpaper_url").eq("id", conversationId).maybeSingle();
    const appearanceQuery = db
      .from("chat_appearance_preferences")
      .select("font_size, bubble_style, bubble_color, wallpaper_url")
      .eq("user_id", userId)
      .eq("conversation_id", conversationId)
      .maybeSingle();

    const [{ data: conv }, membershipRes, wallpaperRes, appearanceRes] = await Promise.all([
      convQuery,
      membershipQuery,
      wallpaperQuery,
      appearanceQuery,
    ]);
    if (!conv) return null;

    // Fetched separately from the main SELECT above, deliberately: migration
    // 0073 (wallpaper_url) may not be applied to the live database the
    // instant this code deploys (the two happen independently — code ships
    // on push, the SQL migration is a separate manual step). Folding this
    // column into the main SELECT means a missing column fails the WHOLE
    // query, 404ing every single conversation thread until the migration
    // lands — confirmed by reproducing it locally. A separate, best-effort
    // query means a not-yet-applied migration only ever costs the wallpaper
    // feature itself, never breaks messaging as a whole.
    // Issued in the parallel batch above; still its own query (not folded into
    // the conversation SELECT) for the reason in the comment above.
    const wallpaperUrl = (wallpaperRes.data?.wallpaper_url as string | null) ?? null;

    // The viewer's OWN personal appearance for THIS chat (font style + bubble
    // style/color) — SSR-read so the saved look paints on the first frame,
    // never a default-blue flash-then-switch every time the thread opens
    // (owner report 2026-07-16). Best-effort + separate from the main SELECT
    // for the same reason as wallpaper above: migration 0078 (the per-chat
    // `conversation_id` column) may not be applied the instant this deploys,
    // and a missing column must only cost this one feature, never 404 the
    // whole thread. Scoped by user_id here since the admin client bypasses RLS.
    let appearance: ChatAppearance = DEFAULT_CHAT_APPEARANCE;
    try {
      // Issued in the parallel batch above. `wallpaper_url` arrives with
      // migration 0080 (the "Only you" scope) — if it's ever missing, the retry
      // below drops it so an unapplied 0080 costs ONLY the personal wallpaper,
      // not the font/bubble settings that share this row (supabase-js fails the
      // whole SELECT if any named column is missing).
      const { data: ap, error } = appearanceRes;
      if (error?.code === "42703") {
        const { data: legacy } = await db
          .from("chat_appearance_preferences")
          .select("font_size, bubble_style, bubble_color")
          .eq("user_id", userId)
          .eq("conversation_id", conversationId)
          .maybeSingle();
        appearance = fromChatAppearanceRow((legacy as ChatAppearanceRow | null) ?? null);
      } else {
        appearance = fromChatAppearanceRow((ap as ChatAppearanceRow | null) ?? null);
      }
    } catch {
      /* migration 0078 not applied yet — appearance stays default */
    }

    // Already fetched in the parallel batch at the top of this function.
    const myMembership = membershipRes.data;
    if (!myMembership) return null;

    // Start the MESSAGES query before resolving the roster below — the two are
    // independent (messages are filtered by conversation, not by member), so
    // there is no reason for the biggest query on this path to queue behind a
    // profile lookup. Part of the 2026-07-16 latency pass; see the note on the
    // parallel batch above for the measurements.
    //
    // `queryStartedAt` MUST be captured here, before the query is issued — see
    // its own note further down: it becomes the next delta sync's `since`, and
    // a timestamp taken after the query returns could silently skip a message
    // that changed while it ran.
    const queryStartedAt = new Date().toISOString();
    const messagesPromise = fetchMessageRows(db, conversationId, sinceUpdatedAt);

    let other: OtherUser | null = null;
    let members: ConversationMember[] = [];
    // Part 11b — "read receipts" toggle: if the OTHER person has disabled
    // sharing their own read status, messages the viewer sent never show a
    // "seen" tick (readAt suppressed below). Only meaningful for direct
    // threads — groups have no per-message read-receipt UI at all.
    let otherReadReceiptsEnabled = true;
    // Part 11b — the VIEWER's own "show when I'm typing" toggle (applies to
    // every conversation type, unlike read receipts which are direct-only) —
    // fetched once here rather than as a separate client-side round trip
    // from use-typing.ts, matching how otherReadReceiptsEnabled is sourced.
    const viewerPrivPromise = db.from("privacy_settings").select("typing_indicators_enabled").eq("user_id", userId).maybeSingle();

    if (conv.type === "direct" || conv.type === "secret") {
      const otherId = conv.user_low === userId ? (conv.user_high as string | null) : (conv.user_low as string | null);
      if (otherId) {
        const [{ data: otherPriv }, { data: prof }] = await Promise.all([
          db.from("privacy_settings").select("read_receipts_enabled").eq("user_id", otherId).maybeSingle(),
          db.from("profiles").select("id, handle, display_name, avatar_url, is_verified").eq("id", otherId).maybeSingle(),
        ]);
        otherReadReceiptsEnabled = otherPriv?.read_receipts_enabled ?? true;
        other = prof
          ? {
              id: prof.id as string,
              handle: prof.handle as string,
              displayName: (prof.display_name as string) || `@${prof.handle as string}`,
              avatarUrl: (prof.avatar_url as string) ?? null,
              isVerified: (prof.is_verified as boolean) ?? false,
            }
          : null;
      }
    } else {
      const { data: memberRows } = await db
        .from("conversation_members")
        .select("user_id, role")
        .eq("conversation_id", conversationId)
        .is("left_at", null);
      const rows = (memberRows ?? []) as { user_id: string; role: MemberRole }[];
      const ids = rows.map((r) => r.user_id);
      const { data: profs } = ids.length
        ? await db.from("profiles").select("id, handle, display_name, avatar_url, is_verified").in("id", ids)
        : { data: [] as Record<string, unknown>[] };
      const profById = new Map(((profs ?? []) as Record<string, unknown>[]).map((p) => [p.id as string, p]));
      members = rows
        .map((r) => {
          const p = profById.get(r.user_id);
          if (!p || !p.handle) return null;
          return {
            id: r.user_id,
            handle: p.handle as string,
            displayName: (p.display_name as string) || `@${p.handle as string}`,
            avatarUrl: (p.avatar_url as string) ?? null,
            isVerified: (p.is_verified as boolean) ?? false,
            role: r.role,
          } as ConversationMember;
        })
        .filter((m): m is ConversationMember => !!m);
    }

    // Started before the roster resolution above, so it ran alongside it.
    const rows = await messagesPromise;

    const replyIds = [...new Set(rows.map((m) => m.reply_to_id).filter((x): x is string => !!x))];
    const messageIds = rows.map((m) => m.id);
    const [{ data: replyRows }, { data: reactionRows }, { data: attachmentRows }] = await Promise.all([
      replyIds.length
        ? db.from("messages").select("id, sender_id, body, deleted_at").in("id", replyIds)
        : Promise.resolve({ data: [] as { id: string; sender_id: string; body: string; deleted_at: string | null }[] }),
      messageIds.length
        ? db.from("message_reactions").select("message_id, user_id, emoji").in("message_id", messageIds)
        : Promise.resolve({ data: [] as { message_id: string; user_id: string; emoji: string }[] }),
      messageIds.length
        ? db.from("message_attachments").select(ATTACHMENT_COLUMNS).in("message_id", messageIds).order("idx", { ascending: true })
        : Promise.resolve({ data: [] as RawAttachmentRow[] }),
    ]);
    const replyById = new Map(
      ((replyRows ?? []) as { id: string; sender_id: string; body: string; deleted_at: string | null }[]).map((r) => [r.id, r]),
    );
    const reactionsByMsg = aggregateReactions((reactionRows ?? []) as { message_id: string; user_id: string; emoji: string }[], userId);
    const attachmentsByMsg = groupAttachments((attachmentRows ?? []) as RawAttachmentRow[]);

    // Side effect: direct threads mark the other side's messages delivered+read
    // (unchanged); group threads advance the VIEWER's own read cursor instead
    // (no per-message-per-member receipts — see the D4 note in the migration).
    // Fire-and-forget, but `.catch()`'d rather than bare `void` — an
    // unhandled rejection on a promise nobody awaits still fires Node's
    // `unhandledRejection` (this route's own try/catch can't see it, since
    // it isn't awaited inside the try), and on Vercel's Node runtime that can
    // tear down the function instance — no effect on THIS request/response
    // (already sent), but a real one on the container's next invocation.
    // `peek` = "read the thread, but don't claim I opened it" (see the option's
    // note above). Skipping BOTH branches is the whole point: a warm-up must
    // leave read/delivered state exactly as it found it.
    const now = new Date().toISOString();
    if (options?.peek) {
      /* warm-up read — deliberately no receipt writes */
    } else if (conv.type === "direct" || conv.type === "secret") {
      db.from("messages")
        .update({ read_at: now, delivered_at: now })
        .eq("conversation_id", conversationId)
        .neq("sender_id", userId)
        .is("read_at", null)
        .then(undefined, () => {});
    } else {
      db.from("conversation_members")
        .update({ last_read_at: now, last_delivered_at: now })
        .eq("conversation_id", conversationId)
        .eq("user_id", userId)
        .then(undefined, () => {});
    }

    const messages: MessageItem[] = rows.map((m) => {
      const rp = m.reply_to_id ? replyById.get(m.reply_to_id) : null;
      const mine = m.sender_id === userId;
      return {
        id: m.id,
        body: m.deleted_at ? "" : m.body,
        createdAt: m.created_at,
        mine,
        senderId: m.sender_id,
        encryptionIv: m.deleted_at ? null : m.encryption_iv,
        deliveredAt: m.delivered_at,
        // Suppressed (not the real DB value) when this is a message the
        // viewer SENT and the recipient has turned off sharing their own
        // read status — see the read_receipts_enabled fetch above.
        readAt: mine && !otherReadReceiptsEnabled ? null : m.read_at,
        replyTo: rp ? { id: rp.id, body: rp.deleted_at ? "" : rp.body, senderId: rp.sender_id, deleted: !!rp.deleted_at } : null,
        editedAt: m.edited_at,
        deletedAt: m.deleted_at,
        pinned: m.pinned,
        reactions: reactionsByMsg.get(m.id) ?? [],
        attachments: m.deleted_at ? [] : (attachmentsByMsg.get(m.id) ?? []),
        metadata: m.deleted_at ? null : m.metadata,
        // Absent column (0081 unapplied) === the column's own default (true).
        allowReshare: m.allow_reshare ?? true,
      };
    });

    const { data: viewerPriv } = await viewerPrivPromise;

    return {
      id: conversationId,
      type: conv.type,
      title: conv.title,
      avatarUrl: conv.avatar_url,
      other,
      members,
      viewerRole: (myMembership.role as MemberRole) ?? null,
      onlyAdminsCanSend: (conv.only_admins_can_send as boolean | null) ?? false,
      disappearAfterSeconds: (conv.disappear_after_seconds as number | null) ?? null,
      theme: (conv.theme as ConversationTheme | null) ?? null,
      wallpaperUrl,
      appearance,
      viewerTypingIndicatorsEnabled: (viewerPriv?.typing_indicators_enabled as boolean | null) ?? true,
      messages,
      syncedAt: queryStartedAt,
    };
  } catch {
    return null;
  }
}
