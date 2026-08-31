"use client";

import { useEffect } from "react";

import { revalidate } from "@/features/data";
import type { ConversationSummary } from "@/lib/social/messages";
import type { BrowserClient } from "@/lib/supabase/client-instance";
import { getClient } from "@/lib/supabase/client-lazy";

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
  const res = await fetch("/api/messages");
  if (!res.ok) return { conversations: [], unread: 0 };
  const d = (await res.json()) as Inbox;
  return { conversations: d.conversations ?? [], unread: d.unread ?? 0 };
}

/**
 * Live inbox: every active `conversation_members` row you have gets its
 * `updated_at` touched whenever a message is sent/edited/deleted in that
 * conversation, or its title/avatar/roster changes — one column, one filter
 * (`user_id=eq.<uid>`), covering direct AND group conversations alike.
 * (Previously this subscribed to two separate `conversations` channels,
 * `user_low`/`user_high`, because postgres_changes can't OR across columns
 * — that hack no longer applies now that membership lives in its own table.)
 */
export function useInboxRealtime(): void {
  useEffect(() => {
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

    const bump = () => void revalidate(INBOX_KEY, loadInbox, 0).catch(() => {});

    void getClient()
      .then(async (client) => {
        if (cancelled) return;
        supabase = client;
        const { data: auth } = await client.auth.getUser();
        const uid = auth.user?.id;
        if (!uid || cancelled) return;
        channel = client
          .channel(`inbox:${uid}`)
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "conversation_members", filter: `user_id=eq.${uid}` },
            bump,
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
