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
 *
 * Feature 20 Part 6 — multi-device sync on the SAME channel: when one session
 * reads, archives or clears, it announces ONE broadcast ("sync") and the member's
 * other open sessions (phone ↔ laptop) refresh their bell and center. A broadcast,
 * not row UPDATE events: "mark all read" can touch hundreds of rows, and that must
 * not become hundreds of socket messages. The announcement carries no content —
 * a receiver only re-reads its own list through RLS — and it costs nothing while idle.
 */
export interface NotificationInsert {
  id?: string;
  type?: string;
}
type Listener = (row: NotificationInsert) => void;

const listeners = new Set<Listener>();
const syncListeners = new Set<() => void>();
let teardown: (() => void) | null = null;
let live: { send: () => void } | null = null;

function fire<T>(set: Set<(a: T) => void>, arg: T) {
  for (const l of [...set]) {
    try {
      l(arg);
    } catch {
      /* one listener never breaks the others */
    }
  }
}

function open() {
  const supabase = createClient();
  let channel: ReturnType<typeof supabase.channel> | null = null;
  let closed = false;
  void getClientAuthUser(supabase).then(({ data: auth }) => {
    const uid = auth.user?.id;
    if (!uid || closed) return;
    const ch = supabase
      .channel(`notifications:${uid}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${uid}` }, (payload) => fire(listeners, payload.new as NotificationInsert))
      .on("broadcast", { event: "sync" }, () => fire(syncListeners, undefined))
      .subscribe();
    channel = ch;
    live = { send: () => void ch.send({ type: "broadcast", event: "sync", payload: {} }).catch(() => {}) };
  });
  return () => {
    closed = true;
    live = null;
    if (channel) void supabase.removeChannel(channel);
  };
}

function release() {
  if (listeners.size === 0 && syncListeners.size === 0 && teardown) {
    teardown();
    teardown = null;
  }
}

/** Listen for my new notification rows. Returns the unsubscribe. */
export function onNotificationInsert(listener: Listener): () => void {
  listeners.add(listener);
  if (!teardown) teardown = open();
  return () => {
    listeners.delete(listener);
    release();
  };
}

/** Listen for "another of my sessions changed my notifications" (read, archive, clear). Returns the unsubscribe. */
export function onNotificationSync(listener: () => void): () => void {
  syncListeners.add(listener);
  if (!teardown) teardown = open();
  return () => {
    syncListeners.delete(listener);
    release();
  };
}

/** Tell my other sessions to refresh — call AFTER the server accepted the change. A no-op when the stream isn't open. */
export function announceNotificationSync(): void {
  live?.send();
}

/** Test seam: how many listeners and whether the channel is open. */
export function notificationStreamState() {
  return { listeners: listeners.size + syncListeners.size, open: teardown !== null };
}
