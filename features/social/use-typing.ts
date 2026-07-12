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
 */
export function useTypingIndicator(conversationId: string, viewerId: string, viewerName: string) {
  const [typingNames, setTypingNames] = useState<string[]>([]);
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trackedRef = useRef(false);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`typing:${conversationId}`, { config: { private: true } });
    channelRef.current = channel;

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
      .subscribe();

    // Presence state can go stale if a tab is killed mid-"typing" (no leave
    // event fires) — a periodic re-check clears it once STALE_MS passes.
    const staleCheck = setInterval(recompute, 2_000);

    return () => {
      clearInterval(staleCheck);
      if (clearTimer.current) clearTimeout(clearTimer.current);
      // removeChannel — the browser client is a shared singleton
      // (lib/supabase/client.ts), and this hook mounts/tears down with every
      // thread visit, so a leaked channel here compounded exactly the same
      // way conversation-room.tsx's did.
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [conversationId, viewerId]);

  /** Call on every composer keystroke — debounced, auto-clears after idle. */
  const notifyTyping = useCallback(() => {
    const channel = channelRef.current;
    if (!channel) return;
    if (!trackedRef.current) trackedRef.current = true;
    void channel.track({ typing: true, at: Date.now(), name: viewerName } satisfies TypingPayload);
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => {
      void channel.track({ typing: false, at: Date.now(), name: viewerName } satisfies TypingPayload);
    }, IDLE_CLEAR_MS);
  }, [viewerName]);

  /** Call immediately on send — no need to wait out the idle timer. */
  const clearTyping = useCallback(() => {
    const channel = channelRef.current;
    if (clearTimer.current) clearTimeout(clearTimer.current);
    if (!channel || !trackedRef.current) return;
    void channel.track({ typing: false, at: Date.now(), name: viewerName } satisfies TypingPayload);
  }, [viewerName]);

  return { typingNames, notifyTyping, clearTyping };
}
