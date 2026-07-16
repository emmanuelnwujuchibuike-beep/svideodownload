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
const threadCache = new Map<string, ThreadCacheEntry>();

export function getCachedThread(conversationId: string): ThreadCacheEntry | undefined {
  return threadCache.get(conversationId);
}

export function cacheThread(conversationId: string, entry: ThreadCacheEntry): void {
  threadCache.delete(conversationId); // re-insert so Map's insertion order tracks MRU
  threadCache.set(conversationId, entry);
  if (threadCache.size > THREAD_CACHE_LIMIT) {
    const oldestKey = threadCache.keys().next().value;
    if (oldestKey) threadCache.delete(oldestKey);
  }
}

/** Is this thread already warm? Lets the inbox skip re-fetching one it has. */
export function isThreadWarm(conversationId: string): boolean {
  return threadCache.has(conversationId);
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

export async function warmThread(conversationId: string): Promise<void> {
  if (threadCache.has(conversationId)) return;
  // Share an in-flight warm rather than starting a second one. The inbox's
  // warm loop restarts whenever the conversation ORDER changes (a new message
  // bumps a thread to the top), which cancels the loop mid-thread — the thread
  // it was fetching isn't in the cache yet, so the restarted loop would fetch
  // it again. Observed live: two duplicate fetches per inbox load. Harmless
  // (peek reads are idempotent) but pure waste on a phone's connection.
  const existing = inFlight.get(conversationId);
  if (existing) return existing;

  const run = (async () => {
    try {
      const res = await fetch(`/api/messages/${conversationId}?peek=1`, { cache: "no-store" });
      if (!res.ok) return;
      const d = (await res.json()) as { messages?: MessageItem[]; syncedAt?: string };
      if (!d.messages) return;
      cacheThread(conversationId, { messages: d.messages, syncedAt: d.syncedAt ?? new Date().toISOString() });
    } catch {
      /* a failed warm is a non-event — the room fetches normally on open */
    } finally {
      inFlight.delete(conversationId);
    }
  })();
  inFlight.set(conversationId, run);
  return run;
}
