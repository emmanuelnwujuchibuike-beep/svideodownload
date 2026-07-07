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
 * Live inbox: a `conversations` row is touched (last_message_at/last_body) whenever
 * a message is sent, so we subscribe to changes on the two conversations the viewer
 * can be part of (user_low / user_high) and revalidate the shared inbox key.
 */
export function useInboxRealtime(): void {
  useEffect(() => {
    const supabase = createClient();
    const channels: ReturnType<typeof supabase.channel>[] = [];
    let cancelled = false;

    const bump = () => void revalidate(INBOX_KEY, loadInbox, 0).catch(() => {});

    supabase.auth.getUser().then(({ data: auth }) => {
      const uid = auth.user?.id;
      if (!uid || cancelled) return;
      for (const col of ["user_low", "user_high"] as const) {
        const ch = supabase
          .channel(`inbox:${col}:${uid}`)
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "conversations", filter: `${col}=eq.${uid}` },
            bump,
          )
          .subscribe();
        channels.push(ch);
      }
    });

    // Realtime has no replay: refresh the inbox whenever the app resumes or
    // comes back online, so unread badges are right even after a long sleep.
    const onVisible = () => {
      if (document.visibilityState === "visible") bump();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", bump);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", bump);
      for (const ch of channels) void ch.unsubscribe();
    };
  }, []);
}
