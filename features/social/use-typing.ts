"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";

const IDLE_CLEAR_MS = 3_000;
const STALE_MS = 5_000;

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
  const joinedRef = useRef(false);
  // The latest state we WANT tracked — flushed on join, so a keystroke that
  // raced the initial subscribe still lands instead of silently dropping.
  const desiredRef = useRef<TypingPayload | null>(null);
  const viewerNameRef = useRef(viewerName);
  viewerNameRef.current = viewerName;

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`typing:${conversationId}`, {
      config: { private: true, presence: { key: viewerId } },
    });
    channelRef.current = channel;
    joinedRef.current = false;

    const recompute = () => {
      const state = channel.presenceState<TypingPayload>();
      const now = Date.now();
      const names: string[] = [];
      for (const key of Object.keys(state)) {
        if (key === viewerId) continue;
        const entries = state[key];
        const latest = entries?.[entries.length - 1];
        if (latest?.typing && now - latest.at < STALE_MS) names.push(latest.name);
      }
      setTypingNames(names);
    };

    channel
      .on("presence", { event: "sync" }, recompute)
      .on("presence", { event: "join" }, recompute)
      .on("presence", { event: "leave" }, recompute)
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
    const staleCheck = setInterval(recompute, 2_000);

    return () => {
      clearInterval(staleCheck);
      if (clearTimer.current) clearTimeout(clearTimer.current);
      desiredRef.current = null;
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

  /** Call on every composer keystroke — debounced, auto-clears after idle. No-ops entirely when the viewer has turned off "show when I'm typing". */
  const notifyTyping = useCallback(() => {
    if (!broadcastEnabled) return;
    trackState(true);
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => trackState(false), IDLE_CLEAR_MS);
  }, [broadcastEnabled, trackState]);

  /** Call immediately on send — no need to wait out the idle timer. */
  const clearTyping = useCallback(() => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
    trackState(false);
  }, [trackState]);

  return { typingNames, notifyTyping, clearTyping };
}
