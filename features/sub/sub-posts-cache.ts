"use client";

/**
 * The SUB POSTS gallery's first page, fetched ONCE per creator and kept for four
 * minutes (owner 2026-10-12: "sub post takes time to load when the section opens").
 *
 *   · the profile's SUB tab warms it the moment a finger touches the tab, so the
 *     request is already in flight when the gallery mounts
 *   · reopening the tab within four minutes shows the same page at once
 *
 * Four minutes because a subscriber's page carries five-minute private links
 * (lib/sub/posts.ts) — a cached page is never served with links about to lapse.
 * Memory only, never storage: nothing private outlives the tab. A tiny module, so
 * the profile can import it without pulling the gallery in.
 */
const FRESH_MS = 4 * 60_000;
export const SUB_POSTS_FRESH_MS = FRESH_MS;
const pages = new Map<string, { at: number; p: Promise<unknown> }>();

/** When the cached page (and so its private links) was asked for — null when none is cached. */
export function subPostsLoadedAt(creatorId: string): number | null {
  return pages.get(creatorId)?.at ?? null;
}

export function loadSubPosts(creatorId: string): Promise<unknown> {
  const hit = pages.get(creatorId);
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.p;
  const p = fetch(`/api/sub/posts?creator=${creatorId}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))));
  // a failed read is never cached — the next open asks again
  p.catch(() => pages.delete(creatorId));
  pages.set(creatorId, { at: Date.now(), p });
  return p;
}

/** Drop the cached page — after a post is added or deleted, or a purchase settles. */
export function forgetSubPosts(creatorId: string): void {
  pages.delete(creatorId);
}
