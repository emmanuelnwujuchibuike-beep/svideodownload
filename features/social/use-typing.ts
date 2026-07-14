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
 * One real realtime channel per conversation, shared by every hook instance
 * observing it — reference-counted, torn down once the last observer
 * unmounts. Root-fixes a real production crash (owner report, 2026-07-13:
 * "message page still shows same error on loading"): `app/(app)/messages/layout.tsx`
 * always mounts its desktop pane's `ConversationList` (just CSS-hidden via
 * `hidden lg:flex`, not unmounted) ALONGSIDE `app/(app)/messages/page.tsx`'s
 * own mobile list — so on every single visit to /messages, TWO separate
 * `ConversationRow` instances for the same conversation each tried to open
 * their own `supabase.channel("typing:<id>", ...)` for the identical topic.
 * `@supabase/realtime-js` reuses/returns the existing channel object for an
 * already-registered topic, so the second caller's `.on("presence", ...)`
 * registrations landed on a channel that had ALREADY called `.subscribe()`
 * — which realtime-js throws on ("cannot add `presence` callbacks... after
 * `subscribe()`"), an uncaught render-path error that crashed the whole page
 * to the generic error boundary. Confirmed empirically with two fresh test
 * accounts + a real `next start` build + Playwright, not by reading alone
 * (see [[feedback-verify-empirically-not-by-reading]]) — a prior fix this
 * same day only special-cased ONE narrower collision (a list row vs. that
 * same conversation's own open-thread channel) and missed this far more
 * common one, which is why that fix didn't resolve the report. The correct,
 * general fix is here: no matter how many components observe a given
 * conversation at once (mobile list, desktop pane list, the open thread
 * itself), there is exactly one channel and one `.subscribe()` call for it.
 */
interface SharedTyping {
  channel: ReturnType<ReturnType<typeof createClient>["channel"]>;
  refCount: number;
  joined: boolean;
  listeners: Set<(names: string[]) => void>;
  /** RECEIVER-side bookkeeping: our own clock's last-observed `typing:true` per presence key — see the module doc on `use-typing.ts` for why this never trusts the sender's own embedded timestamp. */
  seen: Map<string, number>;
  /** The state WE want tracked (this conversation's own outbound typing signal) — shared so any observer's `notifyTyping()`/`clearTyping()` call reaches the one real channel, and flushed on (re)join in case a call raced the initial subscribe. */
  desired: TypingPayload | null;
  isTyping: boolean;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  clearTimer: ReturnType<typeof setTimeout> | null;
  staleInterval: ReturnType<typeof setInterval>;
}

const registry = new Map<string, SharedTyping>();

function namesFromEntry(entry: SharedTyping): string[] {
  const state = entry.channel.presenceState<TypingPayload>();
  const names: string[] = [];
  for (const [key] of entry.seen) {
    const entries = state[key];
    const latest = entries?.[entries.length - 1];
    if (latest?.typing) names.push(latest.name);
  }
  return names;
}

function notifyListeners(entry: SharedTyping): void {
  const names = namesFromEntry(entry);
  for (const listener of entry.listeners) listener(names);
}

function acquireChannel(conversationId: string, viewerId: string): SharedTyping {
  const existing = registry.get(conversationId);
  if (existing) {
    existing.refCount++;
    return existing;
  }

  const supabase = createClient();
  const channel = supabase.channel(`typing:${conversationId}`, {
    config: { private: true, presence: { key: viewerId } },
  });

  const entry: SharedTyping = {
    channel,
    refCount: 1,
    joined: false,
    listeners: new Set(),
    seen: new Map(),
    desired: null,
    isTyping: false,
    heartbeatTimer: null,
    clearTimer: null,
    staleInterval: undefined as unknown as ReturnType<typeof setInterval>,
  };

  // Event-driven: sync/join/leave fire when presence state ACTUALLY changes
  // (a genuine track() call landed) — so refreshing OUR clock here is a real
  // signal, not just time passing.
  const onPresenceEvent = () => {
    const state = channel.presenceState<TypingPayload>();
    const now = Date.now();
    for (const key of Object.keys(state)) {
      if (key === viewerId) continue;
      const entries = state[key];
      const latest = entries?.[entries.length - 1];
      if (latest?.typing) entry.seen.set(key, now);
      // An explicit `typing:false` (stopped/sent/backgrounded) clears
      // immediately — no need to wait out STALE_MS for a real stop signal.
      else entry.seen.delete(key);
    }
    // Drop any key no longer present in presence state at all (e.g. a leave
    // without a graceful `typing:false` track first).
    for (const key of entry.seen.keys()) {
      if (!(key in state)) entry.seen.delete(key);
    }
    notifyListeners(entry);
  };

  // Interval-driven: this is the actual safety net for a dead tab that never
  // sent a clean `typing:false` (crash, killed process) — it must only EVICT
  // stale entries, never refresh them, or a sender whose socket died mid-burst
  // would look "typing" forever.
  const pruneStale = () => {
    const now = Date.now();
    let changed = false;
    for (const [key, lastAt] of entry.seen) {
      if (now - lastAt >= STALE_MS) {
        entry.seen.delete(key);
        changed = true;
      }
    }
    if (changed) notifyListeners(entry);
  };

  channel.on("presence", { event: "sync" }, onPresenceEvent).on("presence", { event: "join" }, onPresenceEvent).on("presence", { event: "leave" }, onPresenceEvent);

  // `private: true` channels enforce Realtime Authorization at JOIN time —
  // the join request needs a real JWT for `auth.uid()` to resolve inside the
  // RLS policy (migration 0066). Real bug found 2026-07-14 (owner: "typing
  // still isn't showing", confirmed via raw websocket-frame capture): this
  // channel is very often the FIRST one any component opens on a fresh page
  // load/reconnect, racing ahead of `@supabase/ssr`'s own async session-
  // bootstrap — its join frame went out with no `access_token` at all, and
  // the server rejected it outright ("Unauthorized: You do not have
  // permissions..."), while every sibling (non-private) channel on the same
  // socket joined fine a beat later once the session had loaded. Every other
  // channel in this app is non-private, so none of them depend on this
  // timing — this is the only place it was ever reachable. Awaiting
  // `getSession()` once (cached instantly on every call after the first)
  // guarantees the client's realtime auth is populated before this specific
  // join goes out.
  void supabase.auth.getSession().then(() => {
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        entry.joined = true;
        if (entry.desired) void channel.track(entry.desired);
      } else if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        entry.joined = false;
      }
    });
  });

  entry.staleInterval = setInterval(pruneStale, 2_000);
  registry.set(conversationId, entry);
  return entry;
}

function releaseChannel(conversationId: string): void {
  const entry = registry.get(conversationId);
  if (!entry) return;
  entry.refCount--;
  if (entry.refCount > 0) return;
  clearInterval(entry.staleInterval);
  if (entry.clearTimer) clearTimeout(entry.clearTimer);
  if (entry.heartbeatTimer) clearInterval(entry.heartbeatTimer);
  const supabase = createClient();
  void supabase.removeChannel(entry.channel);
  registry.delete(conversationId);
}

/**
 * Typing indicator via a per-thread, PRIVATE Presence channel (topic
 * `typing:<conversationId>`) — private because Presence/Broadcast channels
 * are NOT protected by table RLS the way `postgres_changes` is; without
 * Realtime Authorization (migration 0043's policy on `realtime.messages`)
 * any signed-in user who knew a conversation's id could join and see (or
 * spoof) who's typing in a thread they're not even a member of.
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
 *
 * 2026-07-13 rework — the channel itself is now a shared, ref-counted
 * singleton per conversationId (see the module doc above `acquireChannel`)
 * rather than one-per-hook-instance, fixing a real production crash caused
 * by more than one observer of the same conversation subscribing at once.
 */
export function useTypingIndicator(
  conversationId: string,
  viewerId: string,
  viewerName: string,
  /** Part 11b privacy toggle — viewer's own "show when I'm typing" choice. False mutes only OUR OWN outbound `typing:true` broadcast; we still join the channel and see everyone else's typing state normally. */
  broadcastEnabled = true,
) {
  const [typingNames, setTypingNames] = useState<string[]>([]);
  const entryRef = useRef<SharedTyping | null>(null);
  const viewerNameRef = useRef(viewerName);
  viewerNameRef.current = viewerName;

  useEffect(() => {
    // An empty conversationId is the list page's way of saying "this row
    // isn't subscribed" (capped upstream) — skip opening a channel entirely
    // rather than joining a nonsense `typing:` topic per uncapped row.
    if (!conversationId) {
      setTypingNames([]);
      return;
    }
    const entry = acquireChannel(conversationId, viewerId);
    entryRef.current = entry;
    const listener = (names: string[]) => setTypingNames(names);
    entry.listeners.add(listener);
    listener(namesFromEntry(entry)); // seed with whatever's already known

    return () => {
      entry.listeners.delete(listener);
      entryRef.current = null;
      releaseChannel(conversationId);
    };
  }, [conversationId, viewerId]);

  // Stop broadcasting the instant the tab is backgrounded/app is suspended —
  // don't wait out the idle timer (which still fires, just not necessarily
  // right away if the browser throttles a backgrounded tab's timers).
  useEffect(() => {
    const onVisibility = () => {
      const entry = entryRef.current;
      if (!entry) return;
      if (document.visibilityState === "hidden" && entry.isTyping) {
        if (entry.clearTimer) clearTimeout(entry.clearTimer);
        if (entry.heartbeatTimer) clearInterval(entry.heartbeatTimer);
        entry.isTyping = false;
        const payload: TypingPayload = { typing: false, at: Date.now(), name: viewerNameRef.current };
        entry.desired = payload;
        if (entry.joined) void entry.channel.track(payload);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const trackState = useCallback((typing: boolean) => {
    const entry = entryRef.current;
    if (!entry) return;
    const payload: TypingPayload = { typing, at: Date.now(), name: viewerNameRef.current };
    entry.desired = payload;
    if (entry.joined) void entry.channel.track(payload);
  }, []);

  /**
   * Call on every composer keystroke. Only actually BROADCASTS on the first
   * keystroke of a typing burst (gated by the shared entry's `isTyping`) —
   * every following keystroke just resets the idle timer, so a fast typist
   * doesn't flood Realtime with a track() per keypress. A HEARTBEAT_MS
   * heartbeat re-tracks for as long as the burst continues, so the
   * receiver's own staleness bookkeeping never goes stale while the sender
   * is genuinely still typing. Auto-clears after IDLE_CLEAR_MS of no
   * further keystrokes. No-ops entirely when the viewer has turned off
   * "show when I'm typing".
   */
  const notifyTyping = useCallback(() => {
    if (!broadcastEnabled) return;
    const entry = entryRef.current;
    if (!entry) return;
    if (!entry.isTyping) {
      entry.isTyping = true;
      trackState(true);
      if (entry.heartbeatTimer) clearInterval(entry.heartbeatTimer);
      entry.heartbeatTimer = setInterval(() => {
        if (entry.isTyping) trackState(true);
      }, HEARTBEAT_MS);
    }
    if (entry.clearTimer) clearTimeout(entry.clearTimer);
    entry.clearTimer = setTimeout(() => {
      entry.isTyping = false;
      if (entry.heartbeatTimer) {
        clearInterval(entry.heartbeatTimer);
        entry.heartbeatTimer = null;
      }
      trackState(false);
    }, IDLE_CLEAR_MS);
  }, [broadcastEnabled, trackState]);

  /** Call immediately on send/input-cleared/conversation-change — no need to wait out the idle timer. */
  const clearTyping = useCallback(() => {
    const entry = entryRef.current;
    if (entry) {
      if (entry.clearTimer) clearTimeout(entry.clearTimer);
      if (entry.heartbeatTimer) {
        clearInterval(entry.heartbeatTimer);
        entry.heartbeatTimer = null;
      }
      entry.isTyping = false;
    }
    trackState(false);
  }, [trackState]);

  return { typingNames, notifyTyping, clearTyping };
}
