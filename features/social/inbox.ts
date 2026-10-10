"use client";

import { useEffect } from "react";

import { getEntry, mutate, revalidate, seed } from "@/features/data";
import { hasAuthCookie } from "@/lib/auth/has-auth-cookie";
import { readIdentity } from "@/lib/auth/identity-cache";
import type { FriendRequestItem } from "@/lib/social/friends";
import { readInboxCache, writeInboxCache } from "@/lib/social/inbox-cache";
import type { ConversationSummary } from "@/lib/social/messages";
import type { BrowserClient } from "@/lib/supabase/client-instance";
import { getClient } from "@/lib/supabase/client-lazy";
import { getClientAuthUser } from "@/lib/supabase/client-user";

/**
 * Shared inbox state for the topbar badge AND the /messages list — one cache key
 * so they stay in lockstep and only fetch once. Cached-first like the rest of the
 * app, plus a realtime subscription so new/updated conversations arrive live.
 */
export const INBOX_KEY = "inbox";

export interface Inbox {
  conversations: ConversationSummary[];
  unread: number;
}

export async function loadInbox(): Promise<Inbox> {
  /*
    No session cookie ⇒ no inbox, and the server would answer a guest with
    nothing anyway. Measured 2026-10-05: every signed-out page view paid one
    `/api/messages` invocation through the bottom nav's unread badge. One
    gate here covers every consumer (nav, bell, floating chat, unread dot).
    Any cookie at all still asks the server — see lib/auth/has-auth-cookie.ts.
  */
  if (!hasAuthCookie()) return { conversations: [], unread: 0 };
  const res = await fetch("/api/messages");
  if (!res.ok) return { conversations: [], unread: 0 };
  const d = (await res.json()) as Inbox;
  return { conversations: d.conversations ?? [], unread: d.unread ?? 0 };
}

/** Incoming friend requests (the inbox's Requests tab), in the shared cache beside the inbox. */
export const INBOX_REQUESTS_KEY = "inbox-requests";

export async function loadInboxRequests(): Promise<FriendRequestItem[]> {
  if (!hasAuthCookie()) return [];
  const res = await fetch("/api/messages?requests=1");
  if (!res.ok) return [];
  const d = (await res.json()) as { requests?: FriendRequestItem[] };
  return d.requests ?? [];
}

/**
 * Paint from the device on a cold start (lib/social/inbox-cache.ts): fill the
 * shared cache from what this ACCOUNT saw last, when memory has nothing. `seed`,
 * never `mutate` — the fetch that follows must still win (see seed's note).
 * Returns true when the inbox in memory did NOT come from the network yet, so
 * the caller knows to refresh it.
 */
export function primeInboxFromDevice(): boolean {
  if (typeof window === "undefined") return false;
  const entry = getEntry<Inbox>(INBOX_KEY);
  if (entry.data === undefined) {
    const saved = readInboxCache(readIdentity()?.handle);
    if (saved) {
      seed<Inbox>(INBOX_KEY, { conversations: saved.conversations, unread: saved.unread });
      if (saved.requests && getEntry<FriendRequestItem[]>(INBOX_REQUESTS_KEY).data === undefined) seed(INBOX_REQUESTS_KEY, saved.requests);
    }
  }
  return getEntry<Inbox>(INBOX_KEY).updatedAt === 0;
}

/** Keep the device copy current with what is on screen (debounced; a burst of messages is one write). */
export function usePersistInbox(inbox: Inbox | undefined, requests: FriendRequestItem[] | undefined): void {
  useEffect(() => {
    if (!inbox && !requests) return;
    const id = setTimeout(() => writeInboxCache(readIdentity()?.handle, inbox ?? null, requests ?? null), 800);
    return () => clearTimeout(id);
  }, [inbox, requests]);
}

/**
 * Fold freshly built summaries for `ids` into the cached inbox: those rows are
 * replaced (or dropped, when the server no longer lists them — left, hidden,
 * secret), new ones are added, and the order is the server's own — pinned
 * first, then newest message first. Pure, so it is unit-tested.
 */
export function mergeInboxRows(prev: Inbox, ids: string[], fresh: ConversationSummary[]): Inbox {
  const touched = new Set(ids);
  const conversations = prev.conversations.filter((c) => !touched.has(c.id)).concat(fresh.filter((c) => touched.has(c.id)));
  conversations.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime();
  });
  return { conversations, unread: conversations.filter((c) => c.unread).length };
}

/** Rebuilds only `ids` on the server and patches them into the cache. False ⇒ the caller does a full reload. */
async function patchInbox(ids: string[]): Promise<boolean> {
  if (getEntry<Inbox>(INBOX_KEY).data === undefined) return false;
  try {
    const res = await fetch(`/api/messages?ids=${ids.map(encodeURIComponent).join(",")}`);
    if (!res.ok) return false;
    const d = (await res.json()) as { conversations?: ConversationSummary[] };
    if (!Array.isArray(d.conversations)) return false;
    const fresh = d.conversations;
    mutate<Inbox>(INBOX_KEY, (prev) => (prev ? mergeInboxRows(prev, ids, fresh) : prev!));
    return true;
  } catch {
    return false;
  }
}

/** A partial refresh asks for at most this many conversations; a bigger burst reloads the inbox. */
const MAX_PATCH_IDS = 20;

/**
 * Live inbox: every active `conversation_members` row you have gets its
 * `updated_at` touched whenever a message is sent/edited/deleted in that
 * conversation, or its title/avatar/roster changes — one column, one filter
 * (`user_id=eq.<uid>`), covering direct AND group conversations alike.
 * (Previously this subscribed to two separate `conversations` channels,
 * `user_low`/`user_high`, because postgres_changes can't OR across columns
 * — that hack no longer applies now that membership lives in its own table.)
 */
/** How long a burst of inbox events waits for quiet before the one refetch it becomes. */
export const INBOX_COALESCE_MS = 350;

export function useInboxRealtime(): void {
  useEffect(() => {
    // A guest has no inbox to listen to — no socket, no 60 kB client chunk.
    if (!hasAuthCookie()) return;
    /*
      Memoized singleton (lib/supabase/client-instance.ts) — safe to request
      again here even though conversation-room.tsx also does; both share one
      client and one Realtime socket instead of each opening its own.

      Awaited now rather than constructed inline: this module sits on the
      landing page's critical path (via mobile-nav), and a static import of
      `@supabase/ssr` here put 60 kB of it in front of the first tap. See
      lib/supabase/client-lazy.ts. `supabase` is captured so cleanup can remove
      the channel from the same client that created it.
    */
    let supabase: BrowserClient | null = null;
    let channel: Parameters<BrowserClient["removeChannel"]>[0] | null = null;
    let cancelled = false;

    /*
      🔴 ONLY THE CONVERSATIONS THAT CHANGED (2026-10-09, owner: "each message
      triggering full inbox refetch — fix it").

      Every message touches the viewer's `conversation_members` row for that
      conversation, and each event used to reload the WHOLE inbox — the full
      `listConversations` (every membership, several hundred message rows).
      Now each event's `conversation_id` is collected, a burst waits 350 ms of
      quiet, and ONE request rebuilds just those conversations on the server
      (`/api/messages?ids=…`, the same function and rules) and patches them into
      the cached list in place. The other rows are not refetched or rebuilt.

      A full reload remains only where a patch cannot be trusted: the
      reconnect (`online`, which may have missed anything), an event without a
      conversation id, a burst over MAX_PATCH_IDS, no cached inbox yet, or a
      failed patch. An event that lands while a pass is running is not
      swallowed: it schedules one more pass, so the list ends on the latest state.
    */
    let timer: ReturnType<typeof setTimeout> | null = null;
    let running = false;
    const dirty = new Set<string>();
    let fullNeeded = false;
    const flush = async () => {
      timer = null;
      if (running) return; // the running pass re-checks `dirty` / `fullNeeded` before it ends
      running = true;
      try {
        while (!cancelled && (fullNeeded || dirty.size > 0)) {
          const ids = [...dirty];
          dirty.clear();
          const full = fullNeeded || ids.length > MAX_PATCH_IDS;
          fullNeeded = false;
          const patched = full ? false : await patchInbox(ids);
          if (!patched) await revalidate(INBOX_KEY, loadInbox, 0).catch(() => {});
        }
      } finally {
        running = false;
      }
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void flush(), INBOX_COALESCE_MS);
    };
    const onChange = (payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
      const id = payload?.new?.conversation_id ?? payload?.old?.conversation_id;
      if (typeof id === "string" && id) dirty.add(id);
      else fullNeeded = true;
      schedule();
    };
    const bump = () => {
      fullNeeded = true;
      schedule();
    };

    void getClient()
      .then(async (client) => {
        if (cancelled) return;
        supabase = client;
        const { data: auth } = await getClientAuthUser(client);
        const uid = auth.user?.id;
        if (!uid || cancelled) return;
        channel = client
          .channel(`inbox:${uid}`)
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "conversation_members", filter: `user_id=eq.${uid}` },
            onChange,
          )
          .subscribe();
        // Unmounted while `getUser()` was in flight — the subscribe above still
        // happened, so tear it down rather than leak the channel.
        if (cancelled) {
          void client.removeChannel(channel);
          channel = null;
        }
      })
      .catch(() => {
        // Offline, or a stale hashed chunk after a deploy. The badge simply
        // stops live-updating; `loadInbox()` still populates it on navigation.
      });

    // Refresh the inbox when the network reconnects (a genuine "realtime
    // restored" event that can carry messages missed while offline) — but NOT on
    // visibilitychange/resume. A `visibilitychange` bump here fired on every iOS
    // back-swipe / app resume and refetched the whole conversation list, which
    // is exactly the "message page reloads on swipe back" the owner reported
    // (2026-07-21). The live `postgres_changes` subscription above keeps the
    // inbox current on real activity (a new/edited/removed message bumps
    // `conversation_members.updated_at`); `online` only ever fires on an actual
    // connectivity transition, never on a plain back-swipe.
    window.addEventListener("online", bump);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("online", bump);
      if (channel && supabase) void supabase.removeChannel(channel);
    };
  }, []);
}

/** Mount once in the app shell so the inbox badge live-updates app-wide, not just while a thread is open. */
export function InboxRealtimeTracker() {
  useInboxRealtime();
  return null;
}
