"use client";

import type { MessageItem } from "@/lib/social/messages";

/**
 * A session-warm cache of thread message lists, keyed by conversation id.
 *
 * Lives in its own module (not inside `conversation-room.tsx`) so the INBOX can
 * warm threads without importing the 2,300-line room component — importing it
 * for two helpers would pull the entire chat UI, its editor, sheets and
 * recorder into the inbox's bundle for no reason.
 *
 * Tab-lifetime, no TTL, MRU-capped — the same shape as
 * `message-post-embed.tsx`'s own module cache, one level up: instead of one
 * shared-post preview per id, this holds a whole thread per conversation id.
 * `ConversationRoom` seeds its initial state from here and still runs its own
 * `resync()` on mount regardless, so a cached thread is never
 * stale-but-trusted — this only removes the visible reload, never the
 * correctness of catching up.
 */
export interface ThreadCacheEntry {
  messages: MessageItem[];
  syncedAt: string;
}

const THREAD_CACHE_LIMIT = 10;
/*
  🔴 KEYED BY VIEWER TOO (owner, 2026-10-28: "received gift should appear on the left side … and the send on the
  right"). The owner switches between two of their own accounts in one PWA and chats between them, so both open the
  SAME conversation id. Every row's `mine` (left/right, "You sent…", ticks) is the viewer's, and a copy cached by one
  account painted the other account's sides — a received gift on the right, as if sent. A copy is only ever served
  back to the account that fetched it.
*/
const threadCache = new Map<string, ThreadCacheEntry>();
const keyOf = (viewerId: string, conversationId: string) => `${viewerId}:${conversationId}`;

export function getCachedThread(viewerId: string, conversationId: string): ThreadCacheEntry | undefined {
  return threadCache.get(keyOf(viewerId, conversationId));
}

export function cacheThread(viewerId: string, conversationId: string, entry: ThreadCacheEntry): void {
  const key = keyOf(viewerId, conversationId);
  threadCache.delete(key); // re-insert so Map's insertion order tracks MRU
  threadCache.set(key, entry);
  if (threadCache.size > THREAD_CACHE_LIMIT) {
    const oldestKey = threadCache.keys().next().value;
    if (oldestKey) threadCache.delete(oldestKey);
  }
}

/** Is this thread already warm? Lets the inbox skip re-fetching one it has. */
export function isThreadWarm(viewerId: string, conversationId: string): boolean {
  return threadCache.has(keyOf(viewerId, conversationId));
}

/**
 * Pre-load a thread into the SAME cache `ConversationRoom` reads on mount, so
 * opening that chat paints its messages in the first frame instead of streaming
 * them.
 *
 * Owner (2026-07-16): "chats should load one after the other from top to bottom
 * immediately the message page is opened to avoid loading of chats, so they
 * warm up immediately the inbox page is opened."
 *
 * `?peek=1` is load-bearing, not an optimisation: it reads the thread WITHOUT
 * marking anything read. An earlier warm-up (`prefetchAllThreads`) was DELETED
 * for exactly this — it used the normal path, so merely opening the inbox
 * marked every conversation read and showed senders a false "Seen" on messages
 * the recipient had never looked at, defeating the read-receipts toggle.
 * Warming must be invisible to everyone else. See `getConversation`'s `peek`
 * option, where the opt-out is an explicit argument rather than a convention.
 */
const inFlight = new Map<string, Promise<void>>();

export async function warmThread(viewerId: string, conversationId: string): Promise<void> {
  const key = keyOf(viewerId, conversationId);
  if (threadCache.has(key)) return;
  // Share an in-flight warm rather than starting a second one. The inbox's
  // warm loop restarts whenever the conversation ORDER changes (a new message
  // bumps a thread to the top), which cancels the loop mid-thread — the thread
  // it was fetching isn't in the cache yet, so the restarted loop would fetch
  // it again. Observed live: two duplicate fetches per inbox load. Harmless
  // (peek reads are idempotent) but pure waste on a phone's connection.
  const existing = inFlight.get(key);
  if (existing) return existing;

  const run = (async () => {
    try {
      const res = await fetch(`/api/messages/${conversationId}?peek=1`, { cache: "no-store" });
      if (!res.ok) return;
      const d = (await res.json()) as { messages?: MessageItem[]; syncedAt?: string };
      if (!d.messages) return;
      cacheThread(viewerId, conversationId, { messages: d.messages, syncedAt: d.syncedAt ?? new Date().toISOString() });
    } catch {
      /* a failed warm is a non-event — the room fetches normally on open */
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, run);
  return run;
}

/**
 * The session copy plus the server rows NEWER than its newest message (owner,
 * 2026-10-14: a message that arrived while the chat was closed didn't show on
 * entry). Only newer rows: an older row the copy lacks may have been removed
 * on purpose, and the server copy can be hours old on a client navigation.
 */
export function mergeMissing(cached: MessageItem[], fresh: MessageItem[]): MessageItem[] {
  const newest = cached.reduce((t, m) => Math.max(t, Date.parse(m.createdAt) || 0), 0);
  const have = new Set(cached.map((m) => m.id));
  const add = fresh.filter((m) => !have.has(m.id) && Date.parse(m.createdAt) > newest);
  if (add.length === 0) return cached;
  return [...cached, ...add].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}
