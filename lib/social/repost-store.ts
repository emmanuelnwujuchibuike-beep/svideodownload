"use client";

import { useEffect, useState } from "react";

import { getApi } from "@/lib/sdk/browser";

import type { RepostAudience } from "./repost/audience";

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

/** Extra facts a repost can carry (Feature 15 · Part 4). */
export interface RepostOptions {
  /** Who this recommendation reaches. Defaults to public server-side. */
  audience?: RepostAudience;
  /** Provenance — the repost the viewer found this through. */
  sourceRepostId?: string | null;
  /** One attachment on a quote repost. */
  quoteMedia?: { kind: "image" | "gif"; url: string; width?: number; height?: number } | null;
}

/** Optimistically toggle a repost everywhere, then persist; rolls back on failure. */
export async function toggleRepost(
  postId: string,
  next: boolean,
  currentCount: number,
  caption?: string | null,
  options?: RepostOptions,
): Promise<RepostState> {
  const prev = state.get(postId) ?? { reposted: !next, count: currentCount };
  // 🔴 Only a PUBLIC repost moves the visible count. A private one that bumped
  // it would announce its own existence — the count is the leak, not the row —
  // and the server does not increment it either, so an optimistic bump here
  // would also snap back on the response and read as a glitch.
  const countsPublicly = !options?.audience || options.audience === "public";
  const delta = countsPublicly ? (next ? 1 : -1) : 0;
  state.set(postId, { reposted: next, count: Math.max(0, prev.count + delta) });
  emit();
  try {
    const body =
      next && (caption || options?.audience || options?.sourceRepostId || options?.quoteMedia)
        ? {
            ...(caption ? { caption } : {}),
            ...(options?.audience ? { audience: options.audience } : {}),
            ...(options?.sourceRepostId ? { sourceRepostId: options.sourceRepostId } : {}),
            ...(options?.quoteMedia ? { quoteMedia: options.quoteMedia } : {}),
          }
        : undefined;
    const res = await getApi().action<{ reposted: boolean; count: number }>(`/api/posts/${postId}/repost`, {
      method: next ? "POST" : "DELETE",
      ...(body ? { body } : {}),
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

/** Edit this repost's caption (15-minute server-enforced window). */
export async function editRepostCaption(postId: string, caption: string | null): Promise<void> {
  await getApi().action(`/api/posts/${postId}/repost`, { method: "PATCH", body: { caption } });
}

/** Pin or unpin this repost on the profile Reposts tab. */
export async function setRepostPinned(postId: string, pinned: boolean): Promise<void> {
  await getApi().action(`/api/posts/${postId}/repost`, { method: "PATCH", body: { pinned } });
}

/**
 * Change who can see an existing repost.
 *
 * No edit window, unlike the caption: narrowing an audience is a privacy
 * correction and must always be possible. See the PATCH handler for why
 * widening is allowed too.
 */
export async function setRepostAudience(postId: string, audience: RepostAudience): Promise<void> {
  await getApi().action(`/api/posts/${postId}/repost`, { method: "PATCH", body: { audience } });
}
