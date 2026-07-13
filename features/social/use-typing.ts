"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";

const IDLE_CLEAR_MS = 3_000;
const STALE_MS = 5_000;
// While a burst is ongoing, re-track at this cadence so the RECEIVER's own
// last-seen bookkeeping keeps getting refreshed — see the HEARTBEAT_MS usage
// below and the receiver-local-timestamp fix in `onPresenceEvent()`.
const HEARTBEAT_MS = 2_000;

interface TypingPayload {
  typing: boolean;
  at: number;
  name: string;
}

/**
 * Typing indicator via a per-thread, PRIVATE Presence channel (topic
 * `typing:<conversationId>`) — private because Presence/Broadcast channels
 * are NOT protected by table RLS the way `postgres_changes` is; without
 * Realtime Authorization (migration 0043's policy on `realtime.messages`)
 * any signed-in user who knew a conversation's id could join and see (or
 * spoof) who's typing in a thread they're not even a member of. Scoped to
 * one thread at a time (mounted/torn down with the open ConversationRoom),
 * unlike the app-wide singleton `presence:online` channel.
 *
 * 2026-07-12 rework — the original version had two real bugs that made the
 * indicator never work in practice (owner report):
 *  1. No `presence.key` was set, so the server assigned every client a
 *     RANDOM UUID presence key — `key === viewerId` (the skip-self check)
 *     never matched anything, and the roster was keyed by meaningless ids.
 *     The key is now the viewer's user id, which also collapses multiple
 *     tabs from the same user into one presence entry.
 *  2. `channel.track()` calls made before the channel finished joining are
 *     REJECTED by realtime-js (not queued) — fast typists hit this on their
 *     first keystrokes, and if the join was slow every track before it was
 *     silently lost. Track state is now buffered until `SUBSCRIBED` and
 *     re-sent on every (re)join.
 */
export function useTypingIndicator(
  conversationId: string,
  viewerId: string,
  viewerName: string,
  /** Part 11b privacy toggle — viewer's own "show when I'm typing" choice. False mutes only OUR OWN outbound `typing:true` broadcast; we still join the channel and see everyone else's typing state normally. */
  broadcastEnabled = true,
) {
  const [typingNames, setTypingNames] = useState<string[]>([]);
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const joinedRef = useRef(false);
  // Whether WE'RE currently broadcast as typing — lets notifyTyping() only
  // actually send the `typing:true` track call once per burst (the first
  // keystroke), instead of on every single keypress.
  const isTypingRef = useRef(false);
  // The latest state we WANT tracked — flushed on join, so a keystroke that
  // raced the initial subscribe still lands instead of silently dropping.
  const desiredRef = useRef<TypingPayload | null>(null);
  const viewerNameRef = useRef(viewerName);
  viewerNameRef.current = viewerName;
  // RECEIVER-side bookkeeping: the local (our own clock) moment we last
  // observed `typing:true` for each presence key. Root-fixes a real bug (owner
  // report: "goes away after ~1s even though they're still typing") — the old
  // code compared `Date.now()` (receiver's clock) against the payload's own
  // embedded `at` (sender's clock, captured ONCE at the start of a typing
  // burst and never refreshed while `isTypingRef` stayed true) — so staleness
  // was really "5s since typing STARTED," not "since it stopped," and any
  // clock skew between the two devices shrank that window further. Stamping
  // our OWN clock the instant we observe a fresh `typing:true` — refreshed by
  // the heartbeat below for as long as the sender keeps typing — removes
  // cross-device clock trust from the equation entirely.
  const lastSeenLocal = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    // An empty conversationId is the list page's way of saying "this row
    // isn't subscribed" (capped upstream) — skip opening a channel entirely
    // rather than joining a nonsense `typing:` topic per uncapped row.
    if (!conversationId) {
      setTypingNames([]);
      return;
    }
    const supabase = createClient();
    const channel = supabase.channel(`typing:${conversationId}`, {
      config: { private: true, presence: { key: viewerId } },
    });
    channelRef.current = channel;
    joinedRef.current = false;

    const seen = lastSeenLocal.current;

    const namesFromSeen = (): string[] => {
      const state = channel.presenceState<TypingPayload>();
      const names: string[] = [];
      for (const [key] of seen) {
        const entries = state[key];
        const latest = entries?.[entries.length - 1];
        if (latest?.typing) names.push(latest.name);
      }
      return names;
    };

    // Event-driven: sync/join/leave fire when presence state ACTUALLY
    // changes (a genuine track() call landed — the first keystroke, the
    // heartbeat's periodic re-track, or an explicit stop) — so refreshing
    // OUR clock here is a real signal, not just time passing.
    const onPresenceEvent = () => {
      const state = channel.presenceState<TypingPayload>();
      const now = Date.now();
      for (const key of Object.keys(state)) {
        if (key === viewerId) continue;
        const entries = state[key];
        const latest = entries?.[entries.length - 1];
        if (latest?.typing) seen.set(key, now);
        // An explicit `typing:false` (stopped/sent/backgrounded) clears
        // immediately — no need to wait out STALE_MS for a real stop signal.
        else seen.delete(key);
      }
      // Drop any key no longer present in presence state at all (e.g. a
      // leave without a graceful `typing:false` track first).
      for (const key of seen.keys()) {
        if (!(key in state)) seen.delete(key);
      }
      setTypingNames(namesFromSeen());
    };

    // Interval-driven: this is the actual safety net for a dead tab that
    // never sent a clean `typing:false` (crash, killed process) — it must
    // only EVICT stale entries, never refresh them, or a sender whose socket
    // died mid-burst would look "typing" forever (nothing else would ever
    // prune it, since no further sync/join/leave event will ever fire for a
    // truly dead connection until the server's own socket timeout).
    const pruneStale = () => {
      const now = Date.now();
      let changed = false;
      for (const [key, lastAt] of seen) {
        if (now - lastAt >= STALE_MS) {
          seen.delete(key);
          changed = true;
        }
      }
      if (changed) setTypingNames(namesFromSeen());
    };

    channel
      .on("presence", { event: "sync" }, onPresenceEvent)
      .on("presence", { event: "join" }, onPresenceEvent)
      .on("presence", { event: "leave" }, onPresenceEvent)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          joinedRef.current = true;
          // Flush whatever the composer wanted tracked while we were joining
          // (or re-establish state after a reconnect's fresh join).
          if (desiredRef.current) void channel.track(desiredRef.current);
        } else if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          joinedRef.current = false;
        }
      });

    // Presence state can go stale if a tab is killed mid-"typing" (no leave
    // event fires) — a periodic re-check clears it once STALE_MS passes.
    const staleCheck = setInterval(pruneStale, 2_000);

    // Stop broadcasting the instant the tab is backgrounded/app is suspended
    // — don't wait out the idle timer (which still fires, just not
    // necessarily right away if the browser throttles a backgrounded
    // tab's timers).
    const onVisibility = () => {
      if (document.visibilityState === "hidden" && isTypingRef.current) {
        if (clearTimer.current) clearTimeout(clearTimer.current);
        if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
        isTypingRef.current = false;
        const payload: TypingPayload = { typing: false, at: Date.now(), name: viewerNameRef.current };
        desiredRef.current = payload;
        if (joinedRef.current) void channel.track(payload);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearInterval(staleCheck);
      document.removeEventListener("visibilitychange", onVisibility);
      if (clearTimer.current) clearTimeout(clearTimer.current);
      if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
      desiredRef.current = null;
      isTypingRef.current = false;
      // removeChannel — the browser client is a shared singleton
      // (lib/supabase/client.ts), and this hook mounts/tears down with every
      // thread visit, so a leaked channel here compounded exactly the same
      // way conversation-room.tsx's did.
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [conversationId, viewerId]);

  const trackState = useCallback((typing: boolean) => {
    const payload: TypingPayload = { typing, at: Date.now(), name: viewerNameRef.current };
    desiredRef.current = payload;
    const channel = channelRef.current;
    if (channel && joinedRef.current) void channel.track(payload);
  }, []);

  /**
   * Call on every composer keystroke. Only actually BROADCASTS on the first
   * keystroke of a typing burst (`isTypingRef` gates repeat calls) — every
   * following keystroke just resets the idle timer, so a fast typist doesn't
   * flood Realtime with a track() per keypress. A HEARTBEAT_MS heartbeat
   * re-tracks for as long as the burst continues, so the receiver's own
   * staleness bookkeeping (see `onPresenceEvent()` above) never goes stale
   * while the sender is genuinely still typing. Auto-clears after IDLE_CLEAR_MS of
   * no further keystrokes. No-ops entirely when the viewer has turned off
   * "show when I'm typing".
   */
  const notifyTyping = useCallback(() => {
    if (!broadcastEnabled) return;
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      trackState(true);
      if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
      heartbeatTimer.current = setInterval(() => {
        if (isTypingRef.current) trackState(true);
      }, HEARTBEAT_MS);
    }
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => {
      isTypingRef.current = false;
      if (heartbeatTimer.current) {
        clearInterval(heartbeatTimer.current);
        heartbeatTimer.current = null;
      }
      trackState(false);
    }, IDLE_CLEAR_MS);
  }, [broadcastEnabled, trackState]);

  /** Call immediately on send/input-cleared/conversation-change — no need to wait out the idle timer. */
  const clearTyping = useCallback(() => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
    if (heartbeatTimer.current) {
      clearInterval(heartbeatTimer.current);
      heartbeatTimer.current = null;
    }
    isTypingRef.current = false;
    trackState(false);
  }, [trackState]);

  return { typingNames, notifyTyping, clearTyping };
}
