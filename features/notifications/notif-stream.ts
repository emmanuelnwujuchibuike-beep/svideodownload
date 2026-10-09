"use client";

import { createClient } from "@/lib/supabase/client";
import { getClientAuthUser } from "@/lib/supabase/client-user";

/**
 * Part 9 — ONE realtime channel for "a notification row was inserted for me".
 *
 * The bell (topbar, app-wide), the live toast (app layout) and the center
 * (/notifications) each used to open their own `postgres_changes` channel on
 * the same `notifications` filter: up to three server-side subscriptions and
 * three socket messages per row. They now register a listener here; the first
 * listener opens the channel, the last one closes it.
 */
export interface NotificationInsert {
  id?: string;
  type?: string;
}
type Listener = (row: NotificationInsert) => void;

const listeners = new Set<Listener>();
let teardown: (() => void) | null = null;

function open() {
  const supabase = createClient();
  let channel: ReturnType<typeof supabase.channel> | null = null;
  let closed = false;
  void getClientAuthUser(supabase).then(({ data: auth }) => {
    const uid = auth.user?.id;
    if (!uid || closed) return;
    channel = supabase
      .channel(`notifications:${uid}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${uid}` }, (payload) => {
        const row = payload.new as NotificationInsert;
        for (const l of [...listeners]) {
          try {
            l(row);
          } catch {
            /* one listener never breaks the others */
          }
        }
      })
      .subscribe();
  });
  return () => {
    closed = true;
    if (channel) void supabase.removeChannel(channel);
  };
}

/** Listen for my new notification rows. Returns the unsubscribe. */
export function onNotificationInsert(listener: Listener): () => void {
  listeners.add(listener);
  if (!teardown) teardown = open();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && teardown) {
      teardown();
      teardown = null;
    }
  };
}

/** Test seam: how many listeners and whether the channel is open. */
export function notificationStreamState() {
  return { listeners: listeners.size, open: teardown !== null };
}
