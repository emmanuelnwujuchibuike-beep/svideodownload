"use client";

import { readIdentity } from "@/lib/auth/identity-cache";
import { LEGACY_SEEN_KEY, SEEN_KEY } from "@/lib/social/story-cache";
import type { StoryGroup } from "@/lib/social/stories";

/**
 * Device-local "seen" tracking for Story rings — a per-device signal (same
 * trade-off already made for the feed's "while you were away" via
 * `localStorage frenz:feed-seen-at`), not a cross-device synced one. Keyed by
 * handle -> the newest story `createdAt` the viewer has opened for that author;
 * a group reads as "seen" once its newest story is at or before that mark.
 *
 * 🔴 PER ACCOUNT (Stories Part 1, 2026-10-26, audit S5): which stories somebody
 * watched is theirs. The marks are saved under the signed-in handle and read back
 * only for it, and cleared on sign-out (`clearStoryCaches`, lib/auth/sign-out.ts).
 * The marks saved before this (under no account) are adopted ONCE by the account
 * signed in when they are first read — they were that device's only account's —
 * so nobody's rings all turn unseen on the day this ships.
 */

export type SeenMap = Record<string, string>;

interface Stored {
  owner: string;
  marks: SeenMap;
}

function owner(): string | null {
  return readIdentity()?.handle ?? null;
}

function read(): SeenMap {
  const me = owner();
  if (!me) return {};
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<Stored>;
      return s.owner === me && s.marks && typeof s.marks === "object" ? (s.marks as SeenMap) : {};
    }
    // first read since Part 1: adopt the unowned marks once, then drop them
    const legacy = localStorage.getItem(LEGACY_SEEN_KEY);
    if (!legacy) return {};
    localStorage.removeItem(LEGACY_SEEN_KEY);
    const marks = JSON.parse(legacy) as SeenMap;
    if (!marks || typeof marks !== "object" || Array.isArray(marks)) return {};
    localStorage.setItem(SEEN_KEY, JSON.stringify({ owner: me, marks } satisfies Stored));
    return marks;
  } catch {
    return {};
  }
}

export function loadSeenMap(): SeenMap {
  if (typeof localStorage === "undefined") return {};
  return read();
}

export function isGroupSeen(group: StoryGroup, seen: SeenMap): boolean {
  const newest = group.stories[0]?.createdAt;
  const mark = seen[group.handle];
  return !!newest && !!mark && mark >= newest;
}

export function markGroupSeen(group: StoryGroup) {
  if (typeof localStorage === "undefined") return;
  const me = owner();
  const newest = group.stories[0]?.createdAt;
  if (!me || !newest) return;
  const map = read();
  const mark = map[group.handle];
  if (mark && mark >= newest) return;
  map[group.handle] = newest;
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify({ owner: me, marks: map } satisfies Stored));
  } catch {
    /* storage full/unavailable — seen-state just won't persist this time */
  }
}
