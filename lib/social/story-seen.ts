"use client";

import { useSyncExternalStore } from "react";

import { readIdentity } from "@/lib/auth/identity-cache";
import { confirmedSeenIds, rememberConfirmedView, subscribeConfirmedSeen } from "@/lib/social/story-cache";
import type { StoryGroup, StoryItem } from "@/lib/social/stories";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  WATCHED OR NOT — the server decides (Stories Part 3, 2026-10-26)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The audit's B4. Until now a ring's colour came from THIS PHONE: a localStorage
 * mark per author ("the newest story time I opened"), written the moment a ring
 * was OPENED — so opening one story of seven greyed all seven, a second phone
 * showed everything unwatched, and the order beside it (Part 2's unwatched-first,
 * from story_views) disagreed with the colour.
 *
 * Now there is one answer, per STORY:
 *
 *   story.seen            the server's — the viewer's own story_views row, read in
 *                         the batch that already orders the rings (stories.ts)
 *   + a confirmed view    what this session's POST /api/stories/:id/views answered
 *                         `recorded: true` for, until the next fetch carries it
 *                         (story-cache.ts `rememberConfirmedView`)
 *
 * Nothing is marked seen on a failed or refused request, nothing is marked for a
 * story that was never on screen, and nothing here outlives the account: the
 * confirmed ids are kept per signed-in handle and dropped on sign-out.
 */

export type SeenOverlay = ReadonlySet<string>;

const NONE: SeenOverlay = new Set();

/** The views this session has had confirmed — re-renders a ring the moment one lands. Empty on the server. */
export function useSeenOverlay(): SeenOverlay {
  return useSyncExternalStore(subscribeConfirmedSeen, confirmedSeenIds, () => NONE);
}

export function isStorySeen(story: StoryItem, overlay: SeenOverlay): boolean {
  return story.seen === true || overlay.has(story.id);
}

/** A ring is "watched" only when EVERY story in it is — one new story makes it unwatched again. */
export function isGroupSeen(group: StoryGroup, overlay: SeenOverlay): boolean {
  return group.stories.length > 0 && group.stories.every((s) => isStorySeen(s, overlay));
}

/* ─────────────────────────── recording a view ──────────────────────────── */

export interface ViewOutcome {
  /** the server holds this view now (written, or already there) */
  recorded: boolean;
  /** false: ended, gone, or no longer the viewer's to see — drop it */
  available: boolean;
}

type Poster = (storyId: string) => Promise<ViewOutcome>;

const postView: Poster = async (storyId) => {
  try {
    const r = await fetch(`/api/stories/${encodeURIComponent(storyId)}/views`, { method: "POST", keepalive: true });
    if (!r.ok) return { recorded: false, available: true };
    const d = (await r.json()) as { recorded?: unknown; available?: unknown };
    return { recorded: d.recorded === true, available: d.available !== false };
  } catch {
    return { recorded: false, available: true };
  }
};

/** One request per story per account per session: re-renders, effects re-running and remounts share it. */
const requests = new Map<string, Promise<ViewOutcome>>();

/**
 * Record that the viewer watched ONE story — called when it is on screen, never
 * for the author's other stories. Deduplicated while in flight and after success;
 * a failure is forgotten, so the next time the story is shown it is tried once
 * more (one request per showing — never a retry loop).
 */
export function recordStoryView(storyId: string, post: Poster = postView): Promise<ViewOutcome> {
  const key = `${readIdentity()?.handle ?? ""}:${storyId}`;
  const existing = requests.get(key);
  if (existing) return existing;
  const p = post(storyId).then((out) => {
    if (out.recorded) rememberConfirmedView(storyId);
    else requests.delete(key);
    return out;
  });
  requests.set(key, p);
  return p;
}

/** Tests only: forget every request this module made. */
export function resetStoryViewRequests(): void {
  requests.clear();
}
