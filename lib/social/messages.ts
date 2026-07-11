import { GROUP_TITLE_MAX, MAX_GROUP_MEMBERS } from "@/lib/social/message-meta";
import { createAdminClient } from "@/lib/supabase/admin";

export { GROUP_TITLE_MAX, MAX_GROUP_MEMBERS };

/**
 * Direct + group messaging. Direct conversations are keyed by a canonical
 * (low,high) pair, same as before; group conversations have no fixed pair —
 * membership for BOTH kinds lives in `conversation_members`. Starting a
 * direct thread is gated by the recipient's messages_policy + blocks;
 * replying in an existing conversation (direct or group) is always allowed
 * for an active member (unless blocked). Group invites are gated by blocks
 * only — being added to a group by someone you know is a different trust
 * action than a cold 1:1 DM (a dedicated "who can add me" privacy setting
 * is a good follow-up, not built here). Reads go through the service role +
 * explicit membership checks; there is still no client UPDATE/DELETE policy
 * on messages/conversations — every mutation funnels through this file.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

const pair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);

type Db = ReturnType<typeof createAdminClient>;
export type ConversationType = "direct" | "group";
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

async function bothBlocked(db: Db, a: string, b: string): Promise<boolean> {
  const { count } = await db
    .from("blocks")
    .select("blocker_id", { head: true, count: "exact" })
    .or(`and(blocker_id.eq.${a},blocked_id.eq.${b}),and(blocker_id.eq.${b},blocked_id.eq.${a})`);
  return (count ?? 0) > 0;
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

    const { data: rec } = await db
      .from("profiles")
      .select("is_suspended, handle")
      .eq("id", recipientId)
      .maybeSingle();
    if (!rec || rec.is_suspended || !rec.handle) return { ok: false, reason: "unavailable" };

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

  const { data: existing } = await db
    .from("conversations")
    .select("id")
    .eq("user_low", low)
    .eq("user_high", high)
    .eq("type", "direct")
    .maybeSingle();
  if (existing) return { ok: true, id: existing.id as string };

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
    if (again) return { ok: true, id: again.id as string };
    return { ok: false, reason: "unavailable" };
  }
  // Best-effort: a lost race here means the concurrent winner already seeded it.
  await db.from("conversation_members").insert([
    { conversation_id: data.id, user_id: low },
    { conversation_id: data.id, user_id: high },
  ]);
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

export async function transferOwnership(
  conversationId: string,
  actorId: string,
  newOwnerId: string,
): Promise<{ ok: boolean; reason?: string }> {
  if (actorId === newOwnerId) return { ok: false, reason: "invalid" };
  try {
    const db = createAdminClient();
    const actorRole = await memberRole(db, conversationId, actorId);
    if (actorRole !== "owner") return { ok: false, reason: "forbidden" };
    const targetRole = await memberRole(db, conversationId, newOwnerId);
    if (!targetRole) return { ok: false, reason: "not_a_member" };

    const { error: demoteErr } = await db
      .from("conversation_members")
      .update({ role: "admin" })
      .eq("conversation_id", conversationId)
      .eq("user_id", actorId);
    if (demoteErr) return { ok: false };
    const { error: promoteErr } = await db
      .from("conversation_members")
      .update({ role: "owner" })
      .eq("conversation_id", conversationId)
      .eq("user_id", newOwnerId);
    if (promoteErr) {
      // Best-effort rollback so we never end up with zero owners.
      await db.from("conversation_members").update({ role: "owner" }).eq("conversation_id", conversationId).eq("user_id", actorId);
      return { ok: false };
    }
    return { ok: true };
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
  patch: Partial<{ muted: boolean; archived: boolean; pinned: boolean }>,
): Promise<{ ok: boolean }> {
  try {
    const db = createAdminClient();
    const clean: Record<string, boolean> = {};
    if (typeof patch.muted === "boolean") clean.muted = patch.muted;
    if (typeof patch.archived === "boolean") clean.archived = patch.archived;
    if (typeof patch.pinned === "boolean") clean.pinned = patch.pinned;
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

/** Fire-and-forget: notify every other active member that a message landed. */
async function notifyMembers(db: Db, conversationId: string, senderId: string, messageId: string): Promise<void> {
  try {
    const { data: members } = await db
      .from("conversation_members")
      .select("user_id")
      .eq("conversation_id", conversationId)
      .is("left_at", null)
      .neq("user_id", senderId);
    const rows = ((members ?? []) as { user_id: string }[]).map((m) => ({
      user_id: m.user_id,
      actor_id: senderId,
      type: "message",
      conversation_id: conversationId,
      message_id: messageId,
    }));
    if (rows.length) await db.from("notifications").insert(rows);
  } catch {
    /* notifications are best-effort */
  }
}

/** Send a message in an existing conversation (sender must be an active member). */
export async function sendMessage(
  senderId: string,
  conversationId: string,
  body: string,
  replyToId?: string,
): Promise<{ ok: true; id: string } | { ok: false }> {
  if (!hasSupabase) return { ok: false };
  const text = body.trim();
  if (!text || text.length > 2000) return { ok: false };
  try {
    const db = createAdminClient();
    const { data: conv } = await db
      .from("conversations")
      .select("id, type, user_low, user_high")
      .eq("id", conversationId)
      .maybeSingle();
    if (!conv) return { ok: false };

    const { data: membership } = await db
      .from("conversation_members")
      .select("user_id")
      .eq("conversation_id", conversationId)
      .eq("user_id", senderId)
      .is("left_at", null)
      .maybeSingle();
    if (!membership) return { ok: false };

    if (conv.type === "direct") {
      const other = conv.user_low === senderId ? (conv.user_high as string | null) : (conv.user_low as string | null);
      if (other && (await bothBlocked(db, senderId, other))) return { ok: false };
    }

    let replyTo: string | null = null;
    if (replyToId) {
      const { data: parent } = await db
        .from("messages")
        .select("id")
        .eq("id", replyToId)
        .eq("conversation_id", conversationId)
        .maybeSingle();
      if (parent) replyTo = parent.id as string;
    }

    const { data: inserted, error } = await db
      .from("messages")
      .insert({ conversation_id: conversationId, sender_id: senderId, body: text, reply_to_id: replyTo })
      .select("id")
      .single();
    if (error || !inserted) return { ok: false };

    void notifyMembers(db, conversationId, senderId, inserted.id as string);

    return { ok: true, id: inserted.id as string };
  } catch {
    return { ok: false };
  }
}

/** Sender-only: edit a message's text (no time cutoff). */
export async function editMessage(userId: string, messageId: string, body: string): Promise<{ ok: boolean; reason?: string }> {
  const text = body.trim();
  if (!text || text.length > 2000) return { ok: false, reason: "invalid" };
  try {
    const db = createAdminClient();
    const { data: msg } = await db.from("messages").select("sender_id, deleted_at").eq("id", messageId).maybeSingle();
    if (!msg) return { ok: false, reason: "not_found" };
    if (msg.sender_id !== userId) return { ok: false, reason: "forbidden" };
    if (msg.deleted_at) return { ok: false, reason: "deleted" };
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
    void db.from("message_reactions").delete().eq("message_id", messageId);
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
  lastAt: string;
  fromMe: boolean;
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
      .select("id, type, title, avatar_url, user_low, user_high, last_body, last_sender_id, last_message_at")
      .in("id", convIds);
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

    const directConvs = convs.filter((c) => c.type === "direct");
    const groupConvs = convs.filter((c) => c.type === "group");
    const directConvIds = directConvs.map((c) => c.id);
    const groupConvIds = groupConvs.map((c) => c.id);
    const directOtherIds = directConvs
      .map((c) => (c.user_low === userId ? c.user_high : c.user_low))
      .filter((id): id is string => !!id);

    const [{ data: profs }, { data: directUnread }, { data: groupUnread }, { data: groupMembers }] = await Promise.all([
      directOtherIds.length
        ? db.from("profiles").select("id, handle, display_name, avatar_url, is_verified, is_suspended").in("id", directOtherIds)
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
    if (directConvIds.length) {
      void db
        .from("messages")
        .update({ delivered_at: new Date().toISOString() })
        .in("conversation_id", directConvIds)
        .neq("sender_id", userId)
        .is("delivered_at", null);
    }

    const out: ConversationSummary[] = [];
    for (const c of convs) {
      const pref = prefByConv.get(c.id);
      if (c.type === "direct") {
        const otherId = c.user_low === userId ? c.user_high : c.user_low;
        const p = otherId ? profById.get(otherId) : null;
        if (!otherId || !p || (p.is_suspended as boolean) || !p.handle) continue;
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

export interface MessageItem {
  id: string;
  body: string;
  createdAt: string;
  mine: boolean;
  senderId: string;
  /** Receipts (for the sender's own messages, direct threads only): when the other side got/read it. */
  deliveredAt: string | null;
  readAt: string | null;
  replyTo: ReplyPreview | null;
  editedAt: string | null;
  deletedAt: string | null;
  pinned: boolean;
  reactions: MessageReactionSummary[];
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
  messages: MessageItem[];
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
}

/** Full thread for an active member; marks read (direct) or advances the read cursor (group). */
export async function getConversation(conversationId: string, userId: string): Promise<ConversationView | null> {
  if (!hasSupabase) return null;
  try {
    const db = createAdminClient();
    const { data: conv } = await db
      .from("conversations")
      .select("id, type, title, avatar_url, user_low, user_high")
      .eq("id", conversationId)
      .maybeSingle();
    if (!conv) return null;

    const { data: myMembership } = await db
      .from("conversation_members")
      .select("role")
      .eq("conversation_id", conversationId)
      .eq("user_id", userId)
      .is("left_at", null)
      .maybeSingle();
    if (!myMembership) return null;

    let other: OtherUser | null = null;
    let members: ConversationMember[] = [];

    if (conv.type === "direct") {
      const otherId = conv.user_low === userId ? (conv.user_high as string | null) : (conv.user_low as string | null);
      if (otherId) {
        const { data: prof } = await db
          .from("profiles")
          .select("id, handle, display_name, avatar_url, is_verified")
          .eq("id", otherId)
          .maybeSingle();
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

    const { data: msgs } = await db
      .from("messages")
      .select("id, sender_id, body, created_at, delivered_at, read_at, reply_to_id, edited_at, deleted_at, pinned")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(300);
    const rows = (msgs ?? []) as RawMessageRow[];

    const replyIds = [...new Set(rows.map((m) => m.reply_to_id).filter((x): x is string => !!x))];
    const messageIds = rows.map((m) => m.id);
    const [{ data: replyRows }, { data: reactionRows }] = await Promise.all([
      replyIds.length
        ? db.from("messages").select("id, sender_id, body, deleted_at").in("id", replyIds)
        : Promise.resolve({ data: [] as { id: string; sender_id: string; body: string; deleted_at: string | null }[] }),
      messageIds.length
        ? db.from("message_reactions").select("message_id, user_id, emoji").in("message_id", messageIds)
        : Promise.resolve({ data: [] as { message_id: string; user_id: string; emoji: string }[] }),
    ]);
    const replyById = new Map(
      ((replyRows ?? []) as { id: string; sender_id: string; body: string; deleted_at: string | null }[]).map((r) => [r.id, r]),
    );
    const reactionsByMsg = aggregateReactions((reactionRows ?? []) as { message_id: string; user_id: string; emoji: string }[], userId);

    // Side effect: direct threads mark the other side's messages delivered+read
    // (unchanged); group threads advance the VIEWER's own read cursor instead
    // (no per-message-per-member receipts — see the D4 note in the migration).
    const now = new Date().toISOString();
    if (conv.type === "direct") {
      void db
        .from("messages")
        .update({ read_at: now, delivered_at: now })
        .eq("conversation_id", conversationId)
        .neq("sender_id", userId)
        .is("read_at", null);
    } else {
      void db
        .from("conversation_members")
        .update({ last_read_at: now, last_delivered_at: now })
        .eq("conversation_id", conversationId)
        .eq("user_id", userId);
    }

    const messages: MessageItem[] = rows.map((m) => {
      const rp = m.reply_to_id ? replyById.get(m.reply_to_id) : null;
      return {
        id: m.id,
        body: m.deleted_at ? "" : m.body,
        createdAt: m.created_at,
        mine: m.sender_id === userId,
        senderId: m.sender_id,
        deliveredAt: m.delivered_at,
        readAt: m.read_at,
        replyTo: rp ? { id: rp.id, body: rp.deleted_at ? "" : rp.body, senderId: rp.sender_id, deleted: !!rp.deleted_at } : null,
        editedAt: m.edited_at,
        deletedAt: m.deleted_at,
        pinned: m.pinned,
        reactions: reactionsByMsg.get(m.id) ?? [],
      };
    });

    return {
      id: conversationId,
      type: conv.type,
      title: conv.title,
      avatarUrl: conv.avatar_url,
      other,
      members,
      viewerRole: (myMembership.role as MemberRole) ?? null,
      messages,
    };
  } catch {
    return null;
  }
}
