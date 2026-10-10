import type { FriendRequestItem } from "@/lib/social/friends";
import type { ConversationSummary } from "@/lib/social/messages";

/**
 * The inbox, kept on THIS device so /messages paints at once on a cold start
 * (owner, 2026-10-10: "nothing in the message page should ever load on first or
 * every entry, it should open instant").
 *
 * iOS tears a home-screen app down all the time, and every relaunch started the
 * inbox from nothing: a server render, then a fetch, behind the stripe loader.
 * Now the last inbox this account saw is painted from here in the first frame,
 * and the network only REFRESHES it.
 *
 *   · per ACCOUNT: saved under the signed-in handle and read back only for that
 *     same handle — a second person signing in on the same phone never sees it
 *   · cleared on sign-out (lib/auth/sign-out.ts), like every other snapshot
 *   · bounded: the newest MAX_ROWS conversations, and dropped after TTL_MS
 *   · cosmetic only — what to PAINT for a moment; every action still goes
 *     through the server session, and the fetch that follows replaces it
 */
const KEY = "frenz-inbox-v1";
export const INBOX_CACHE_MAX_ROWS = 60;
export const INBOX_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface CachedInbox {
  conversations: ConversationSummary[];
  unread: number;
  requests: FriendRequestItem[] | null;
}

interface Stored extends CachedInbox {
  handle: string;
  savedAt: number;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readInboxCache(handle: string | null | undefined, now: number = Date.now()): CachedInbox | null {
  const ls = storage();
  if (!ls || !handle) return null;
  try {
    const raw = ls.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<Stored>;
    if (s.handle !== handle || typeof s.savedAt !== "number" || now - s.savedAt > INBOX_CACHE_TTL_MS) return null;
    if (!Array.isArray(s.conversations)) return null;
    return { conversations: s.conversations, unread: typeof s.unread === "number" ? s.unread : 0, requests: Array.isArray(s.requests) ? s.requests : null };
  } catch {
    return null;
  }
}

/** Save what is on screen now. `requests` null keeps the saved ones. */
export function writeInboxCache(handle: string | null | undefined, inbox: { conversations: ConversationSummary[]; unread: number } | null, requests: FriendRequestItem[] | null, now: number = Date.now()): void {
  const ls = storage();
  if (!ls || !handle) return;
  try {
    const prev = readInboxCache(handle, now);
    const conversations = (inbox?.conversations ?? prev?.conversations ?? []).slice(0, INBOX_CACHE_MAX_ROWS);
    const stored: Stored = {
      handle,
      savedAt: now,
      conversations,
      unread: inbox?.unread ?? prev?.unread ?? 0,
      requests: requests ?? prev?.requests ?? null,
    };
    ls.setItem(KEY, JSON.stringify(stored));
  } catch {
    /* full or blocked storage: the inbox simply loads from the network as before */
  }
}

export function clearInboxCache(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
