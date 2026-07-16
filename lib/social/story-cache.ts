"use client";

import type { StoryGroup } from "@/lib/social/stories";

/**
 * Last-known story rings, persisted to localStorage.
 *
 * Why (owner, 2026-07-16): "the message page still reloads too obvious causing
 * the story section to always load for some seconds everytime a user enters a
 * chat and swipped back."
 *
 * That was a regression from adding the stories row to Messages. On /home the
 * row is SERVER-seeded (`initialGroups`), so it paints instantly. The inbox row
 * is client-only by design — the inbox shell must stay synchronous — so it had
 * nothing to paint until `/api/stories` answered. In-session that's invisible
 * (the shared `stories` cache is already warm), but on iOS a standalone PWA is
 * torn down and relaunched constantly, and the back-swipe gesture can force
 * exactly that: a genuine cold start with an empty module cache. So every
 * swipe-back showed an empty strip that filled in seconds later.
 *
 * A module cache can't survive a process kill; localStorage can. This is the
 * same trick as lib/auth/identity-cache.ts, for the same reason.
 *
 * EXPIRY IS LOAD-BEARING, not hygiene: stories are a 24h product, so a stale
 * cache could paint rings for content that no longer exists — the exact "why is
 * this showing?" confusion the stories investigation already chased once. Every
 * read therefore drops individual stories older than 24h and any group left
 * empty, so the worst case is fewer rings for a moment, never phantom ones. A
 * revalidation is always in flight behind it.
 */

const KEY = "frenz-stories-v1";
const STORY_TTL_MS = 24 * 60 * 60 * 1000;

/** Drop anything the server would already consider expired. */
function prune(groups: StoryGroup[]): StoryGroup[] {
  const now = Date.now();
  const alive: StoryGroup[] = [];
  for (const g of groups) {
    const stories = g.stories.filter((s) => {
      const t = Date.parse(s.createdAt);
      return Number.isFinite(t) && now - t < STORY_TTL_MS;
    });
    if (stories.length > 0) alive.push({ ...g, stories });
  }
  return alive;
}

export function readCachedStories(): StoryGroup[] | undefined {
  // Guard on what this actually depends on, not on `window`. Same effect in a
  // browser and during SSR (neither has localStorage on the server), but it
  // states the real requirement — and a `window` check made this untestable
  // outside a DOM environment for no reason.
  if (typeof localStorage === "undefined") return undefined;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as StoryGroup[];
    if (!Array.isArray(parsed)) return undefined;
    const alive = prune(parsed);
    return alive.length > 0 ? alive : undefined;
  } catch {
    return undefined;
  }
}

export function writeCachedStories(groups: StoryGroup[]): void {
  try {
    // Cap what we persist: this runs on every stories fetch, and localStorage
    // is synchronous — a huge blob here would block the main thread on a page
    // that's meant to feel instant.
    localStorage.setItem(KEY, JSON.stringify(groups.slice(0, 24)));
  } catch {
    /* storage unavailable/full — the row just falls back to fetching */
  }
}

/** The shared fetcher for the `stories` cache key, which also refreshes the
 *  disk copy so the NEXT cold start paints instantly. */
export async function fetchStoryGroups(): Promise<StoryGroup[]> {
  const r = await fetch("/api/stories");
  if (!r.ok) return [];
  const d = (await r.json()) as { groups?: StoryGroup[] };
  const groups = d.groups ?? [];
  writeCachedStories(groups);
  return groups;
}
