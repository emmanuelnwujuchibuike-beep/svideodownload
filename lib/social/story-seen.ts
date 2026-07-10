"use client";

import type { StoryGroup } from "@/lib/social/stories";

/**
 * Device-local "seen" tracking for Story rings — no `story_views` table exists
 * yet, so this is honestly a per-device signal (same trade-off already made
 * for the feed's "while you were away" via `localStorage frenz:feed-seen-at`),
 * not a cross-device synced one. Keyed by handle -> the newest story
 * `createdAt` the viewer has opened for that author; a group reads as "seen"
 * once its newest story is at or before that mark.
 */
const KEY = "frenz:stories-seen";

export type SeenMap = Record<string, string>;

function read(): SeenMap {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as SeenMap;
  } catch {
    return {};
  }
}

export function loadSeenMap(): SeenMap {
  if (typeof window === "undefined") return {};
  return read();
}

export function isGroupSeen(group: StoryGroup, seen: SeenMap): boolean {
  const newest = group.stories[0]?.createdAt;
  const mark = seen[group.handle];
  return !!newest && !!mark && mark >= newest;
}

export function markGroupSeen(group: StoryGroup) {
  if (typeof window === "undefined") return;
  const newest = group.stories[0]?.createdAt;
  if (!newest) return;
  const map = read();
  const mark = map[group.handle];
  if (mark && mark >= newest) return;
  map[group.handle] = newest;
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* storage full/unavailable — seen-state just won't persist this time */
  }
}
