"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

import { getEntry, revalidate, subscribe, type CacheEntry } from "@/features/data";
import { hasAuthCookie } from "@/lib/auth/has-auth-cookie";
import type { FriendRequestItem } from "@/lib/social/friends";
import { getClient } from "@/lib/supabase/client-lazy";
import { getClientAuthUser } from "@/lib/supabase/client-user";

import { ConversationList } from "./conversation-list";
import { INBOX_KEY, INBOX_REQUESTS_KEY, loadInbox, loadInboxRequests, primeInboxFromDevice, type Inbox } from "./inbox";
import { InboxListSkeleton } from "./inbox-shell";

/**
 * The inbox, painted from what is ALREADY on the device (owner, 2026-10-10:
 * "nothing in the message page should ever load on first or every entry, it
 * should open instant, and when it hasn't fully loaded that's when the top
 * header and stripe loader shows").
 *
 * /messages used to be a server render that awaited auth + every conversation
 * + the friend requests before it drew anything — search bar included — so each
 * entry, and every iOS relaunch, sat on the stripe loader. Now:
 *
 *   memory   the shared inbox cache (kept live by the realtime tracker)
 *   device   else what THIS account saw last (lib/social/inbox-cache.ts)
 *   network  refreshes it behind the painted list; only a device that has
 *            never seen an inbox shows the loader, once
 *
 * The data is the same `/api/messages` the nav badge already reads, under the
 * viewer's own session — nothing here decides access.
 */

/*
  The device copy is primed AFTER hydration, never at module load: the cache is
  shared, and a badge or list hydrating from a primed cache renders what the
  server could not (React #418, measured 2026-10-10). The nav primes it in its
  first effect on EVERY page (mobile-nav.tsx), so by the time Chats is tapped
  the list is already in memory and paints in the frame it mounts; a cold load
  of /messages itself shows the loader for one frame, then the saved list.
*/

const EMPTY_ENTRY: CacheEntry = { data: undefined, error: undefined, updatedAt: 0 };

function useEntry<T>(key: string): CacheEntry<T> {
  return useSyncExternalStore(
    (cb) => subscribe(key, cb),
    () => getEntry<T>(key),
    // the server has no device cache: it renders the loader, and hydration then shows the saved list
    () => EMPTY_ENTRY as CacheEntry<T>,
  );
}

/** Friend requests change rarely and arrive by notification; re-read them on entry at most this often. */
const REQUESTS_FRESH_MS = 60_000;

export function InstantInbox({ variant = "page" }: { variant?: "page" | "pane" }) {
  const router = useRouter();
  const inbox = useEntry<Inbox>(INBOX_KEY);
  const requests = useEntry<FriendRequestItem[]>(INBOX_REQUESTS_KEY);
  const [viewerId, setViewerId] = useState("");

  useEffect(() => {
    if (!hasAuthCookie()) {
      router.replace("/login?next=/messages");
      return;
    }
    primeInboxFromDevice();
    // the painted copy came from the device (or nothing): refresh it once, behind the list
    if (getEntry<Inbox>(INBOX_KEY).updatedAt === 0) void revalidate(INBOX_KEY, loadInbox, 0).catch(() => {});
    if (Date.now() - getEntry<FriendRequestItem[]>(INBOX_REQUESTS_KEY).updatedAt > REQUESTS_FRESH_MS) {
      void revalidate(INBOX_REQUESTS_KEY, loadInboxRequests, 0).catch(() => {});
    }
    let cancelled = false;
    void getClient()
      .then((client) => getClientAuthUser(client))
      .then(({ data }) => {
        if (!cancelled) setViewerId(data.user?.id ?? "");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (inbox.data === undefined) {
    if (inbox.error) {
      return (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border/70 p-10 text-center">
          <p className="text-sm font-medium">This is taking longer than usual</p>
          <p className="text-xs text-muted-foreground">Check your connection and try again.</p>
          <button
            type="button"
            onClick={() => void revalidate(INBOX_KEY, loadInbox, 0).catch(() => {})}
            className="inline-flex min-h-[2.75rem] items-center gap-1.5 rounded-xl border border-border px-4 py-2 text-sm font-medium transition hover:bg-secondary"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </button>
        </div>
      );
    }
    return <InboxListSkeleton />;
  }
  return <ConversationList initial={inbox.data.conversations} initialRequests={requests.data ?? []} viewerId={viewerId} variant={variant} />;
}
