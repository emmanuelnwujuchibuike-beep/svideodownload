"use client";

import { useCallback } from "react";
import { useSyncExternalStore } from "react";

import { enqueueOfflineAction } from "@/lib/offline/action-queue";
import type { FollowSource } from "@/lib/social/follow-policy";

/**
 * App-wide follow state, shared across every surface (feed cards, reels, profile
 * headers). Following a creator anywhere instantly updates *all* their cards, so
 * you never see a stale "Follow" button for someone you already follow — the bug
 * where the same person kept re-offering "Follow" on their other posts.
 *
 * The store only ever holds values the user has actually toggled this session;
 * everything else falls back to the server's `isFollowing`, so it's authoritative
 * without needing to be primed.
 */
const state = new Map<string, boolean>();
/** Feature 19 · Part 3: a follow that became a REQUEST (the account approves followers) — shown as "Requested". */
const requested = new Map<string, boolean>();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Reactive follow state for a user, falling back to the server value. */
export function useFollowState(userId: string, initial: boolean): boolean {
  const get = useCallback(() => (state.has(userId) ? state.get(userId)! : initial), [userId, initial]);
  return useSyncExternalStore(subscribe, get, get);
}

/** Whether the viewer has asked to follow and is waiting (this session's answer, else `initial`). */
export function useFollowRequested(userId: string, initial = false): boolean {
  const get = useCallback(() => (requested.has(userId) ? requested.get(userId)! : initial), [userId, initial]);
  return useSyncExternalStore(subscribe, get, get);
}

/**
 * Optimistically toggle follow everywhere, then persist; rolls back on a
 * genuine failure. Follow/unfollow is an idempotent toggle (confirmed against
 * the API: POST no-ops on a duplicate, DELETE no-ops on a missing row), so a
 * request that fails because the device is OFFLINE gets queued for replay
 * instead of rolled back — same "Offline Interactions" treatment as
 * Like/Save (`lib/offline/action-queue.ts`), coalesced under `follow:<userId>`
 * so toggling it twice offline replays only the final state.
 */
export async function toggleFollow(userId: string, next: boolean, source?: FollowSource): Promise<boolean> {
  state.set(userId, next);
  emit();
  const queued = { key: `follow:${userId}`, url: `/api/follow/${userId}`, method: next ? ("POST" as const) : ("DELETE" as const) };
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    await enqueueOfflineAction(queued);
    return next;
  }
  try {
    // where it came from (Feature 19 · Part 3) — counted on the target's Audience page, never who
    const res = await fetch(queued.url, next && source ? { method: queued.method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source }) } : { method: queued.method });
    if (!res.ok) throw new Error();
    // the account approves followers: it became a request, not a follow (Feature 19 · Part 3)
    const body = (await res.json().catch(() => null)) as { requested?: boolean } | null;
    requested.set(userId, !!(next && body?.requested));
    if (next && body?.requested) {
      state.set(userId, false);
      emit();
      return false;
    }
    emit();
    return next;
  } catch {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      await enqueueOfflineAction(queued);
      return next;
    }
    state.set(userId, !next);
    emit();
    return !next;
  }
}
