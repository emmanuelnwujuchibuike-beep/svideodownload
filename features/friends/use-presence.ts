"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

import {
  ensureMyPresenceStatusLoaded,
  getCachedMyPresenceStatus,
  setMyPresenceStatusLocal,
  subscribeMyPresenceStatus,
} from "@/lib/social/presence-status-client";
import { createClient } from "@/lib/supabase/client";

/**
 * Online presence via Supabase Realtime Presence — no extra infrastructure.
 * Every signed-in tab joins one shared channel keyed by user id; whoever is in
 * the channel is "online". A single module-level channel is shared by all
 * consumers on the page (the tracker in the app shell + any hooks), because
 * subscribing the same topic twice on one client throws.
 *
 * "Invisible" (manual presence status, see presence-status.ts) skips
 * `track()` entirely — true invisibility means never appearing online in the
 * first place, not just hiding a status label elsewhere. The channel is
 * still joined (so this tab can still observe who ELSE is online), just
 * never announces itself. Reacts live to status changes mid-session via
 * `subscribeMyPresenceStatus`, not just at initial connect.
 */

let channel: RealtimeChannel | null = null;
let started = false;
let current = new Set<string>();
const listeners = new Set<(online: Set<string>) => void>();

function ensureStarted(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  const supabase = createClient();
  supabase.auth.getUser().then(async ({ data }) => {
    const uid = data.user?.id;
    if (!uid || channel) return;
    const myStatus = await ensureMyPresenceStatusLoaded(uid);
    channel = supabase.channel("presence:online", { config: { presence: { key: uid } } });
    channel
      .on("presence", { event: "sync" }, () => {
        current = new Set(Object.keys(channel?.presenceState() ?? {}));
        listeners.forEach((fn) => fn(current));
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED" && myStatus !== "invisible" && getCachedMyPresenceStatus() !== "invisible") {
          void channel?.track({ at: Date.now() });
        }
      });
    subscribeMyPresenceStatus((status) => {
      if (!channel) return;
      if (status === "invisible") void channel.untrack();
      else void channel.track({ at: Date.now() });
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

// ---------------------------------------------------------------------
// Auto-away idle detection. Only ever drives the available <-> away edge —
// a manually chosen Busy/DND/Invisible is never touched or auto-reverted.
// `wasAutoAway` distinguishes "away because we set it" (revert on activity)
// from "away because the user picked it" (leave it alone) — module-level
// state is safe here since this is a singleton mounted once, same as the
// presence channel above.
// ---------------------------------------------------------------------
const AUTO_AWAY_IDLE_MS = 5 * 60_000;
let autoAwayStarted = false;
let wasAutoAway = false;

async function setStatus(status: "available" | "away"): Promise<void> {
  try {
    const res = await fetch("/api/presence-status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) setMyPresenceStatusLocal(status);
  } catch {
    /* best-effort — next activity/idle tick retries the transition */
  }
}

function ensureAutoAwayStarted(): void {
  if (autoAwayStarted || typeof window === "undefined") return;
  autoAwayStarted = true;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const goIdle = () => {
    if (getCachedMyPresenceStatus() !== "available") return; // only ever touch the default state
    wasAutoAway = true;
    void setStatus("away");
  };

  const onActivity = () => {
    if (idleTimer) clearTimeout(idleTimer);
    if (wasAutoAway) {
      wasAutoAway = false;
      void setStatus("available");
    }
    idleTimer = setTimeout(goIdle, AUTO_AWAY_IDLE_MS);
  };

  const onVisible = () => {
    if (document.visibilityState === "visible") onActivity();
  };

  for (const evt of ["mousemove", "keydown", "touchstart", "scroll"] as const) {
    window.addEventListener(evt, onActivity, { passive: true });
  }
  document.addEventListener("visibilitychange", onVisible);
  idleTimer = setTimeout(goIdle, AUTO_AWAY_IDLE_MS);
}

/** Mount once in the app shell alongside PresenceTracker. */
export function AutoAwayTracker() {
  useEffect(() => ensureAutoAwayStarted(), []);
  return null;
}
