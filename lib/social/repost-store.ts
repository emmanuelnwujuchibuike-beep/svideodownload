"use client";

import { useEffect, useState } from "react";

import { getApi } from "@/lib/sdk/browser";

/**
 * App-wide repost state, shared across every surface (reels, feed, profile), so a
 * repost anywhere updates that post's button + count everywhere and stays
 * consistent for the session. Mirrors the follow store. Goes through the shared
 * SDK, so web exercises the same path native will.
 */
export interface RepostState {
  reposted: boolean;
  count: number;
}

const state = new Map<string, RepostState>();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Reactive repost state for a post, falling back to the server-provided values. */
export function useRepostState(postId: string, initialReposted: boolean, initialCount: number): RepostState {
  const [value, setValue] = useState<RepostState>(() => state.get(postId) ?? { reposted: initialReposted, count: initialCount });
  useEffect(() => {
    const update = () => setValue(state.get(postId) ?? { reposted: initialReposted, count: initialCount });
    update();
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, [postId, initialReposted, initialCount]);
  return value;
}

/** Optimistically toggle a repost everywhere, then persist; rolls back on failure. */
export async function toggleRepost(postId: string, next: boolean, currentCount: number): Promise<RepostState> {
  const prev = state.get(postId) ?? { reposted: !next, count: currentCount };
  state.set(postId, { reposted: next, count: Math.max(0, prev.count + (next ? 1 : -1)) });
  emit();
  try {
    const res = await getApi().action<{ reposted: boolean; count: number }>(`/api/posts/${postId}/repost`, {
      method: next ? "POST" : "DELETE",
    });
    const settled = { reposted: res.reposted, count: res.count };
    state.set(postId, settled);
    emit();
    return settled;
  } catch (e) {
    state.set(postId, prev);
    emit();
    throw e;
  }
}
