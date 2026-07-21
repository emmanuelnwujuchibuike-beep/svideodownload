"use client";

import { useEffect } from "react";

import { revalidate } from "@/features/data";
import type { ConversationSummary } from "@/lib/social/messages";
import { createClient } from "@/lib/supabase/client";

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
    // Memoized singleton (lib/supabase/client.ts) — safe to call again here
    // even though conversation-room.tsx also calls it; both share one client
    // and one Realtime socket now instead of each opening its own.
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    const bump = () => void revalidate(INBOX_KEY, loadInbox, 0).catch(() => {});

    supabase.auth.getUser().then(({ data: auth }) => {
      const uid = auth.user?.id;
      if (!uid || cancelled) return;
      channel = supabase
        .channel(`inbox:${uid}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "conversation_members", filter: `user_id=eq.${uid}` },
          bump,
        )
        .subscribe();
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
      if (channel) void supabase.removeChannel(channel);
    };
  }, []);
}

/** Mount once in the app shell so the inbox badge live-updates app-wide, not just while a thread is open. */
export function InboxRealtimeTracker() {
  useInboxRealtime();
  return null;
}
