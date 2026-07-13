import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Part 10 — message search + starred messages. Scoped to what this app
 * actually has (see migration 0051's header for the full reasoning): real
 * Postgres full-text search over messages you can see, not AI semantic
 * search, voice search, or a cross-product index into things that don't
 * exist here (Communities/Marketplace/Business Chats/AI Chats/Life
 * Memories/Cloud Files).
 */

export interface SearchResultItem {
  messageId: string;
  conversationId: string;
  conversationType: "direct" | "group";
  /** Group title, or the OTHER participant's display name for a direct thread. */
  conversationLabel: string;
  conversationAvatarUrl: string | null;
  senderId: string;
  senderName: string;
  body: string;
  createdAt: string;
}

type Db = ReturnType<typeof createAdminClient>;
interface RawMessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
}

/**
 * Shared enrichment: raw message rows → SearchResultItem[], resolving each
 * conversation's display label (group title, or the other participant's
 * name for a direct thread) and each sender's display name in batch. Used
 * by both `searchMessages` and `listStarredMessages` so the "how do we
 * label a conversation" logic exists exactly once.
 */
async function enrichMessages(db: Db, viewerId: string, messages: RawMessageRow[]): Promise<SearchResultItem[]> {
  if (messages.length === 0) return [];
  const convIds = [...new Set(messages.map((m) => m.conversation_id))];
  const senderIds = [...new Set(messages.map((m) => m.sender_id))];
  const [{ data: convRows }, { data: profRows }] = await Promise.all([
    db.from("conversations").select("id, type, title, avatar_url, user_low, user_high").in("id", convIds),
    db.from("profiles").select("id, handle, display_name, avatar_url").in("id", senderIds),
  ]);
  const profById = new Map(((profRows ?? []) as Record<string, unknown>[]).map((p) => [p.id as string, p]));

  // Direct threads have no `title` — resolve the OTHER participant's name as
  // the conversation label, mirroring listConversations()'s own logic.
  const directOtherIds = new Set<string>();
  const convById = new Map<string, Record<string, unknown>>();
  for (const c of (convRows ?? []) as Record<string, unknown>[]) {
    convById.set(c.id as string, c);
    if (c.type === "direct") {
      const other = c.user_low === viewerId ? (c.user_high as string | null) : (c.user_low as string | null);
      if (other) directOtherIds.add(other);
    }
  }
  if (directOtherIds.size > 0) {
    const { data: otherProfs } = await db.from("profiles").select("id, handle, display_name, avatar_url").in("id", [...directOtherIds]);
    for (const p of (otherProfs ?? []) as Record<string, unknown>[]) profById.set(p.id as string, p);
  }

  const results: SearchResultItem[] = [];
  for (const m of messages) {
    const conv = convById.get(m.conversation_id);
    if (!conv) continue;
    const sender = profById.get(m.sender_id);
    const isGroup = conv.type === "group";
    let label: string;
    let avatarUrl: string | null;
    if (isGroup) {
      label = (conv.title as string | null) ?? "Group chat";
      avatarUrl = (conv.avatar_url as string | null) ?? null;
    } else {
      const otherId = conv.user_low === viewerId ? conv.user_high : conv.user_low;
      const other = profById.get(otherId as string);
      label = other ? (other.display_name as string) || `@${other.handle as string}` : "Direct message";
      avatarUrl = (other?.avatar_url as string | null) ?? null;
    }
    results.push({
      messageId: m.id,
      conversationId: m.conversation_id,
      conversationType: isGroup ? "group" : "direct",
      conversationLabel: label,
      conversationAvatarUrl: avatarUrl,
      senderId: m.sender_id,
      senderName: sender ? (sender.display_name as string) || `@${sender.handle as string}` : "Someone",
      body: m.body,
      createdAt: m.created_at,
    });
  }
  return results;
}

const MAX_RESULTS = 40;

/**
 * Secret Chats (Part 11b) hold only ciphertext — `body_tsv` over ciphertext
 * matches nothing meaningful, so excluding them isn't just correctness, it
 * also makes explicit that these conversations are genuinely not
 * server-searchable (the whole point of encrypting them).
 */
async function excludeSecretConversations(db: Db, conversationIds: string[]): Promise<string[]> {
  if (conversationIds.length === 0) return [];
  const { data } = await db.from("conversations").select("id, type").in("id", conversationIds).neq("type", "secret");
  return ((data ?? []) as { id: string }[]).map((c) => c.id);
}

/**
 * Full-text search over every message in a conversation the viewer is an
 * active member of. Deliberately recency-ordered, not relevance-ranked —
 * `ts_rank` needs a raw RPC the Supabase JS client doesn't expose over
 * `.textSearch()`; recency is the honest, simple ordering for this round
 * (a real relevance rank is a good, identified follow-up, not a silent gap).
 */
export async function searchMessages(viewerId: string, query: string, conversationId?: string): Promise<SearchResultItem[]> {
  const q = query.trim();
  if (!q) return [];
  try {
    const db = createAdminClient();

    const { data: memberRows } = await db
      .from("conversation_members")
      .select("conversation_id")
      .eq("user_id", viewerId)
      .is("left_at", null);
    const myConversationIds = await excludeSecretConversations(
      db,
      ((memberRows ?? []) as { conversation_id: string }[]).map((r) => r.conversation_id),
    );
    if (myConversationIds.length === 0) return [];
    const scopeIds = conversationId ? myConversationIds.filter((id) => id === conversationId) : myConversationIds;
    if (scopeIds.length === 0) return [];

    const { data: rows } = await db
      .from("messages")
      .select("id, conversation_id, sender_id, body, created_at")
      .in("conversation_id", scopeIds)
      .is("deleted_at", null)
      .textSearch("body_tsv", q, { type: "plain" })
      .order("created_at", { ascending: false })
      .limit(MAX_RESULTS);

    return enrichMessages(db, viewerId, (rows ?? []) as RawMessageRow[]);
  } catch {
    return [];
  }
}

export interface StarredMessageItem extends SearchResultItem {
  starredAt: string;
}

const MAX_STARRED = 200;

/** Every message the viewer has starred, newest-starred first. */
export async function listStarredMessages(viewerId: string): Promise<StarredMessageItem[]> {
  try {
    const db = createAdminClient();
    const { data: starRows } = await db
      .from("starred_messages")
      .select("message_id, created_at")
      .eq("user_id", viewerId)
      .order("created_at", { ascending: false })
      .limit(MAX_STARRED);
    const stars = (starRows ?? []) as { message_id: string; created_at: string }[];
    if (stars.length === 0) return [];
    const starredAtById = new Map(stars.map((s) => [s.message_id, s.created_at]));
    const ids = stars.map((s) => s.message_id);

    const { data: msgRows } = await db
      .from("messages")
      .select("id, conversation_id, sender_id, body, created_at, deleted_at")
      .in("id", ids);
    const nonSecretConvIds = new Set(
      await excludeSecretConversations(db, [
        ...new Set(((msgRows ?? []) as { conversation_id: string }[]).map((m) => m.conversation_id)),
      ]),
    );
    const messages = ((msgRows ?? []) as (RawMessageRow & { deleted_at: string | null })[]).filter(
      (m) => !m.deleted_at && nonSecretConvIds.has(m.conversation_id),
    );

    const enriched = await enrichMessages(db, viewerId, messages);
    const results: StarredMessageItem[] = enriched.map((m) => ({ ...m, starredAt: starredAtById.get(m.messageId) ?? m.createdAt }));
    // starred_messages was queried newest-starred-first, but the .in() re-fetch
    // above doesn't preserve that order — restore it explicitly.
    results.sort((a, b) => new Date(b.starredAt).getTime() - new Date(a.starredAt).getTime());
    return results;
  } catch {
    return [];
  }
}
