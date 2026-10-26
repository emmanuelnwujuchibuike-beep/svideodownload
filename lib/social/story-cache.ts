"use client";

import { readIdentity } from "@/lib/auth/identity-cache";
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
 *
 * 🔴 PER ACCOUNT (Stories Part 1, 2026-10-26, audit S5). What one member's rings
 * showed is that member's: who they follow, who blocked whom. `localStorage` is
 * per-origin, not per-account, so the copy is saved under the signed-in handle
 * (the identity cache's) and read back only for that same handle — a second
 * person signing in on the same phone never paints it, even without a sign-out
 * in between — and `clearStoryCaches` drops it on sign-out (lib/auth/sign-out.ts).
 * The same rule as lib/social/inbox-cache.ts.
 */

const KEY = "frenz-stories-v2";
/** The pre-Part-1 copy, saved under no account. Never read again, removed on sight. */
const LEGACY_KEY = "frenz-stories-v1";
const STORY_TTL_MS = 24 * 60 * 60 * 1000;

interface Stored {
  owner: string;
  groups: StoryGroup[];
}

/** The account a copy belongs to: the signed-in handle, or none. */
function currentOwner(): string | null {
  return readIdentity()?.handle ?? null;
}

/** Drop anything the server would already consider expired. */
function prune(groups: StoryGroup[]): StoryGroup[] {
  const now = Date.now();
  const alive: StoryGroup[] = [];
  for (const g of groups) {
    const stories = g.stories.filter((s) => {
      const t = Date.parse(s.createdAt);
      if (!Number.isFinite(t) || now - t >= STORY_TTL_MS) return false;
      // Part 3: a story ended early (its author ended it) carries its real end
      const end = s.expiresAt ? Date.parse(s.expiresAt) : NaN;
      return !Number.isFinite(end) || end > now;
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
    const owner = currentOwner();
    if (!owner) return undefined;
    const raw = localStorage.getItem(KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (parsed.owner !== owner || !Array.isArray(parsed.groups)) return undefined;
    const alive = prune(parsed.groups);
    return alive.length > 0 ? alive : undefined;
  } catch {
    return undefined;
  }
}

export function writeCachedStories(groups: StoryGroup[]): void {
  try {
    localStorage.removeItem(LEGACY_KEY);
    // the old device-local seen marks are dead weight since Part 3 (the server decides)
    localStorage.removeItem(SEEN_KEY);
    localStorage.removeItem(LEGACY_SEEN_KEY);
    const owner = currentOwner();
    // No known account, nothing to file it under — and nothing to paint it for.
    if (!owner) {
      localStorage.removeItem(KEY);
      return;
    }
    // Cap what we persist: this runs on every stories fetch, and localStorage
    // is synchronous — a huge blob here would block the main thread on a page
    // that's meant to feel instant.
    // as many rings as Home shows (Stories Part 2: 50), so a cold start paints the same row the network returns
    const stored: Stored = { owner, groups: groups.slice(0, 50) };
    localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    /* storage unavailable/full — the row just falls back to fetching */
  }
}

/*
  ── Views the server has just confirmed (Stories Part 3, 2026-10-26) ──────────

  Which stories somebody watched comes from the SERVER — each story's `seen`
  (lib/social/stories.ts, from their own story_views rows). This is only the gap
  between "the server confirmed my view" and "the next ring fetch says so": the ids
  whose POST answered `recorded: true` (lib/social/story-seen.ts), so a ring greys
  the moment you close a story, on every surface, with no refetch.

  In memory, for the signed-in account only, and never a source of its own: an id
  gets here only from a confirmed write, so it can only ever agree with the server.
  The disk copy above is patched with the same fact, so a cold start does not paint
  the ring unwatched again before the network answers.
*/
const NO_IDS: ReadonlySet<string> = new Set();
let confirmed: { owner: string | null; ids: ReadonlySet<string> } = { owner: null, ids: NO_IDS };
const seenListeners = new Set<() => void>();

/** The confirmed views of the account signed in NOW — never another account's. Stable between changes. */
export function confirmedSeenIds(): ReadonlySet<string> {
  if (typeof localStorage === "undefined") return NO_IDS;
  return confirmed.owner !== null && confirmed.owner === currentOwner() ? confirmed.ids : NO_IDS;
}

export function subscribeConfirmedSeen(cb: () => void): () => void {
  seenListeners.add(cb);
  return () => void seenListeners.delete(cb);
}

/** Called only after the server answered `recorded: true` for this story. */
export function rememberConfirmedView(storyId: string): void {
  const owner = currentOwner();
  if (!owner) return;
  const prev = confirmed.owner === owner ? confirmed.ids : NO_IDS;
  if (prev.has(storyId)) return;
  confirmed = { owner, ids: new Set(prev).add(storyId) };
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Stored>) : null;
    if (parsed?.owner === owner && Array.isArray(parsed.groups)) {
      const groups = parsed.groups.map((g) => ({ ...g, stories: g.stories.map((s) => (s.id === storyId ? { ...s, seen: true } : s)) }));
      localStorage.setItem(KEY, JSON.stringify({ owner, groups } satisfies Stored));
    }
  } catch {
    /* storage unavailable — the next fetch carries it */
  }
  for (const l of seenListeners) l();
}

/**
 * Every account-specific story copy on this device: the rings, the confirmed
 * views above, and the pre-Part-3 seen marks. Called on sign-out. Shared public
 * data is not here.
 */
export function clearStoryCaches(): void {
  for (const k of [KEY, LEGACY_KEY, SEEN_KEY, LEGACY_SEEN_KEY]) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* storage unavailable — nothing was stored */
    }
  }
  confirmed = { owner: null, ids: NO_IDS };
  for (const l of seenListeners) l();
}

/**
 * The device-local seen marks of Parts 1–2 (story-seen.ts kept the newest story
 * time per author). Since Part 3 they are never read — the server decides — and
 * are removed on sign-out and on the next ring fetch.
 */
export const SEEN_KEY = "frenz:stories-seen-v2";
export const LEGACY_SEEN_KEY = "frenz:stories-seen";

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
