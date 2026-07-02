"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";

/**
 * Online presence via Supabase Realtime Presence — no extra infrastructure.
 * Every signed-in tab joins one shared channel keyed by user id; whoever is in
 * the channel is "online". A single module-level channel is shared by all
 * consumers on the page (the tracker in the app shell + any hooks), because
 * subscribing the same topic twice on one client throws.
 */

let channel: RealtimeChannel | null = null;
let started = false;
let current = new Set<string>();
const listeners = new Set<(online: Set<string>) => void>();

function ensureStarted(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  const supabase = createClient();
  supabase.auth.getUser().then(({ data }) => {
    const uid = data.user?.id;
    if (!uid || channel) return;
    channel = supabase.channel("presence:online", { config: { presence: { key: uid } } });
    channel
      .on("presence", { event: "sync" }, () => {
        current = new Set(Object.keys(channel?.presenceState() ?? {}));
        listeners.forEach((fn) => fn(current));
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void channel?.track({ at: Date.now() });
      });
  });
}

/** Live set of online user ids (empty until the channel syncs). */
export function usePresence(): Set<string> {
  const [online, setOnline] = useState<Set<string>>(current);
  useEffect(() => {
    ensureStarted();
    listeners.add(setOnline);
    setOnline(current);
    return () => {
      listeners.delete(setOnline);
    };
  }, []);
  return online;
}

/** Mount once in the app shell so signed-in users appear online everywhere. */
export function PresenceTracker() {
  useEffect(() => ensureStarted(), []);
  return null;
}
