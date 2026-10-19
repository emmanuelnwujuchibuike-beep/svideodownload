"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

import {
  ensureMyPresenceStatusLoaded,
  getCachedBroadcast,
  getCachedMyPresenceStatus,
  setMyPresenceStatusLocal,
  subscribeMyPresenceStatus,
} from "@/lib/social/presence-status-client";
import { createClient } from "@/lib/supabase/client";
import { getClientAuthUser } from "@/lib/supabase/client-user";

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

/*
  Feature 19 Part 9: the channel is PUBLIC - everyone on it sees every key on it.
  So a member whose last seen is "friends" or "nobody" never tracks here at all
  (before this they did, and anyone saw them "Active now" whatever they chose).
  Their friends see "active recently" through the server instead, which applies
  the setting. The payload carries only the device kind, for the member's own
  "where you're online" list.
*/
const mayTrack = () => getCachedMyPresenceStatus() !== "invisible" && getCachedBroadcast();
function deviceKind(): "phone" | "tablet" | "desktop" {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent;
  if (/iPad|Tablet/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "tablet";
  return /Mobi|iPhone|Android/i.test(ua) ? "phone" : "desktop";
}
const trackPayload = () => ({ at: Date.now(), d: deviceKind() });

/** The member's OWN tabs and devices on the channel right now (Cross-Platform Presence, self only). */
export function myOnlineDevices(uid: string): ("phone" | "tablet" | "desktop")[] {
  const metas = (channel?.presenceState() ?? {})[uid] as { d?: string }[] | undefined;
  return [...new Set((metas ?? []).map((m) => m.d).filter((d): d is "phone" | "tablet" | "desktop" => d === "phone" || d === "tablet" || d === "desktop"))];
}

let channel: RealtimeChannel | null = null;
let started = false;
let lastBeat = 0;
const BEAT_MS = 3 * 60_000;
let current = new Set<string>();
const listeners = new Set<(online: Set<string>) => void>();

function ensureStarted(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  const supabase = createClient();
  getClientAuthUser(supabase).then(async ({ data }) => {
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
          if (mayTrack()) void channel?.track(trackPayload());
          lastBeat = Date.now();
          // "Last seen" heartbeat — bumps user_presence_status.updated_at so
          // PresenceBadge can show "last seen Xm ago" for someone who isn't
          // currently online. Status-change events alone (the only other
          // writer of this column) leave it stale for anyone who stays
          // "available" for a whole session without ever idling into "away"
          // — this fires on every real app open/reconnect instead, which is
          // the same granularity every mainstream chat app's "last seen"
          // actually uses. Skipped for invisible (matches the track() skip
          // above — never touch anything that could reveal activity).
          void fetch("/api/presence-status", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: myStatus }),
          }).catch(() => {});
        }
      });
    subscribeMyPresenceStatus(() => {
      if (!channel) return;
      if (!mayTrack()) void channel.untrack();
      else if (document.visibilityState === "visible") void channel.track(trackPayload());
    });

    /*
      Part 9 (2026-10-09): a backgrounded app is not "online". Every join and
      leave on this shared channel is fanned out to every member, so a phone in
      a pocket kept costing everyone else work. 30 s after the app is hidden it
      leaves the channel's presence (a quick switch-away does not flicker), and
      it rejoins the moment it is visible again.
    */
    let hiddenTimer: ReturnType<typeof setTimeout> | null = null;
    document.addEventListener("visibilitychange", () => {
      if (!channel) return;
      if (document.visibilityState === "hidden") {
        hiddenTimer ??= setTimeout(() => {
          hiddenTimer = null;
          void channel?.untrack();
        }, 30_000);
      } else {
        if (hiddenTimer) {
          clearTimeout(hiddenTimer);
          hiddenTimer = null;
        } else if (mayTrack()) {
          void channel.track(trackPayload());
        } else if (getCachedMyPresenceStatus() !== "invisible" && Date.now() - lastBeat > BEAT_MS) {
          // not on the public channel: one "last active" touch per return to the app, at most every 3 minutes
          lastBeat = Date.now();
          void fetch("/api/presence-status", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: getCachedMyPresenceStatus() }) }).catch(() => {});
        }
      }
    });
  });
}

/**
 * Is this user on the app right now? A one-off read of the same live set, for a decision made
 * at the moment of an action (the typing push asks once per typing burst) — no subscription,
 * so the caller does not re-render on every presence change. False until the channel syncs,
 * and always false for a member who doesn't announce themselves (invisible / restricted last seen).
 */
export function isOnlineNow(uid: string): boolean {
  return current.has(uid);
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

  // Part 9: at most one reaction per 5 s - this ran on every mouse move and scroll frame
  let lastActivity = 0;
  const onActivity = () => {
    const now = Date.now();
    if (!wasAutoAway && now - lastActivity < 5000) return;
    lastActivity = now;
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

  for (const evt of ["pointerdown", "keydown", "touchstart", "scroll"] as const) {
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
