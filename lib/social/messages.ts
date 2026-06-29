import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Direct messages (1:1). Conversations are keyed by a canonical (low,high) pair.
 * Starting a conversation is gated by the recipient's messages_policy + blocks;
 * replies in an existing conversation are always allowed (unless blocked).
 * Reads go through the service role + explicit participant checks.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

const pair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);

export interface OtherUser {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  isVerified: boolean;
}

export type MessageGate =
  | { ok: true }
  | { ok: false; reason: "self" | "blocked" | "off" | "followers" | "unavailable" };

async function bothBlocked(db: ReturnType<typeof createAdminClient>, a: string, b: string): Promise<boolean> {
  const { count } = await db
    .from("blocks")
    .select("blocker_id", { head: true, count: "exact" })
    .or(`and(blocker_id.eq.${a},blocked_id.eq.${b}),and(blocker_id.eq.${b},blocked_id.eq.${a})`);
  return (count ?? 0) > 0;
}

/** Can `senderId` start/continue a conversation with `recipientId`? */
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

/** Gate then get-or-create the conversation for a pair. */
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
    .maybeSingle();
  if (existing) return { ok: true, id: existing.id as string };

  const { data, error } = await db
    .from("conversations")
    .insert({ user_low: low, user_high: high })
    .select("id")
    .single();
  if (error) {
    // Lost a create race → re-select.
    const { data: again } = await db
      .from("conversations")
      .select("id")
      .eq("user_low", low)
      .eq("user_high", high)
      .maybeSingle();
    if (again) return { ok: true, id: again.id as string };
    return { ok: false, reason: "unavailable" };
  }
  return { ok: true, id: data.id as string };
}

/** Send a message in an existing conversation (sender must be a participant). */
export async function sendMessage(
  senderId: string,
  conversationId: string,
  body: string,
): Promise<{ ok: boolean }> {
  if (!hasSupabase) return { ok: false };
  const text = body.trim();
  if (!text || text.length > 2000) return { ok: false };
  try {
    const db = createAdminClient();
    const { data: conv } = await db
      .from("conversations")
      .select("user_low, user_high")
      .eq("id", conversationId)
      .maybeSingle();
    if (!conv) return { ok: false };
    const me = senderId;
    if (conv.user_low !== me && conv.user_high !== me) return { ok: false };
    const other = conv.user_low === me ? (conv.user_high as string) : (conv.user_low as string);
    if (await bothBlocked(db, me, other)) return { ok: false };

    const { error } = await db.from("messages").insert({ conversation_id: conversationId, sender_id: me, body: text });
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}

export interface ConversationSummary {
  id: string;
  other: OtherUser;
  lastBody: string | null;
  lastAt: string;
  fromMe: boolean;
  unread: boolean;
}

/** A user's inbox, newest first. */
export async function listConversations(userId: string): Promise<ConversationSummary[]> {
  if (!hasSupabase) return [];
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("conversations")
      .select("id, user_low, user_high, last_body, last_sender_id, last_message_at")
      .or(`user_low.eq.${userId},user_high.eq.${userId}`)
      .order("last_message_at", { ascending: false })
      .limit(50);
    const convs = (data ?? []) as {
      id: string;
      user_low: string;
      user_high: string;
      last_body: string | null;
      last_sender_id: string | null;
      last_message_at: string;
    }[];
    if (convs.length === 0) return [];

    const otherIds = convs.map((c) => (c.user_low === userId ? c.user_high : c.user_low));
    const convIds = convs.map((c) => c.id);
    const [{ data: profs }, { data: unread }] = await Promise.all([
      db.from("profiles").select("id, handle, display_name, avatar_url, is_verified, is_suspended").in("id", otherIds),
      db.from("messages").select("conversation_id").in("conversation_id", convIds).neq("sender_id", userId).is("read_at", null),
    ]);
    const profById = new Map(((profs ?? []) as Record<string, unknown>[]).map((p) => [p.id as string, p]));
    const unreadConvs = new Set(((unread ?? []) as { conversation_id: string }[]).map((u) => u.conversation_id));

    const out: ConversationSummary[] = [];
    for (const c of convs) {
      const otherId = c.user_low === userId ? c.user_high : c.user_low;
      const p = profById.get(otherId);
      if (!p || (p.is_suspended as boolean) || !p.handle) continue;
      out.push({
        id: c.id,
        other: {
          id: otherId,
          handle: p.handle as string,
          displayName: (p.display_name as string) || `@${p.handle as string}`,
          avatarUrl: (p.avatar_url as string) ?? null,
          isVerified: (p.is_verified as boolean) ?? false,
        },
        lastBody: c.last_body,
        lastAt: c.last_message_at,
        fromMe: c.last_sender_id === userId,
        unread: unreadConvs.has(c.id),
      });
    }
    return out;
  } catch {
    return [];
  }
}

export interface MessageItem {
  id: string;
  body: string;
  createdAt: string;
  mine: boolean;
}

export interface ConversationView {
  id: string;
  other: OtherUser | null;
  messages: MessageItem[];
}

/** Full thread for a participant; marks the other side's messages read. */
export async function getConversation(conversationId: string, userId: string): Promise<ConversationView | null> {
  if (!hasSupabase) return null;
  try {
    const db = createAdminClient();
    const { data: conv } = await db
      .from("conversations")
      .select("user_low, user_high")
      .eq("id", conversationId)
      .maybeSingle();
    if (!conv || (conv.user_low !== userId && conv.user_high !== userId)) return null;
    const otherId = conv.user_low === userId ? (conv.user_high as string) : (conv.user_low as string);

    const [{ data: prof }, { data: msgs }] = await Promise.all([
      db.from("profiles").select("id, handle, display_name, avatar_url, is_verified").eq("id", otherId).maybeSingle(),
      db.from("messages").select("id, sender_id, body, created_at").eq("conversation_id", conversationId).order("created_at", { ascending: true }).limit(300),
    ]);

    // Mark the other side's unread messages as read.
    void db
      .from("messages")
      .update({ read_at: new Date().toISOString() })
      .eq("conversation_id", conversationId)
      .neq("sender_id", userId)
      .is("read_at", null);

    const other: OtherUser | null = prof
      ? {
          id: prof.id as string,
          handle: prof.handle as string,
          displayName: (prof.display_name as string) || `@${prof.handle as string}`,
          avatarUrl: (prof.avatar_url as string) ?? null,
          isVerified: (prof.is_verified as boolean) ?? false,
        }
      : null;

    return {
      id: conversationId,
      other,
      messages: ((msgs ?? []) as { id: string; sender_id: string; body: string; created_at: string }[]).map((m) => ({
        id: m.id,
        body: m.body,
        createdAt: m.created_at,
        mine: m.sender_id === userId,
      })),
    };
  } catch {
    return null;
  }
}
