"use client";

import { useSyncExternalStore } from "react";

import type { DownloadRecord } from "@/types";

/** Global "now playing" state for the in-browser download player — a queue
 *  (Continue Watching's whole row) plus which item is current, so playback
 *  can auto-advance and tap-navigate Stories-style instead of always being a
 *  single, isolated video. */
export interface PlayerQueue {
  items: DownloadRecord[];
  index: number;
}

let current: PlayerQueue | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

// A monotonic count of videos STARTED from the player this session, with its own
// listener set — the download interstitial fires on "3 consecutive history
// watches" and needs the per-video beat, not every queue state change.
let watchCount = 0;
const watchListeners = new Set<() => void>();
function countWatch() {
  watchCount += 1;
  for (const l of watchListeners) l();
}
/** Total videos started from the player this session (never decremented). */
export function getWatchCount(): number {
  return watchCount;
}
/** Subscribe to "a new video started playing" (open, queue open, or advance). */
export function onVideoWatched(cb: () => void): () => void {
  watchListeners.add(cb);
  return () => watchListeners.delete(cb);
}

/** Open a single item with no queue context (e.g. from the Downloads list). */
export function openPlayer(rec: DownloadRecord) {
  current = { items: [rec], index: 0 };
  countWatch();
  emit();
}

/** Open a queue (Continue Watching's row) seeded at whichever item was tapped. */
export function openPlayerQueue(items: DownloadRecord[], startIndex = 0) {
  if (items.length === 0) return;
  current = { items, index: Math.max(0, Math.min(items.length - 1, startIndex)) };
  countWatch();
  emit();
}

export function closePlayer() {
  current = null;
  emit();
}

/** Advance to the next queue item; closes the player once past the last one
 *  (auto-advance on a finished video, or an explicit tap-right). */
export function playerNext() {
  if (!current) return;
  if (current.index < current.items.length - 1) {
    current = { ...current, index: current.index + 1 };
    countWatch(); // advancing to the next clip is another video watched
    emit();
  } else {
    closePlayer();
  }
}

/** Back to the previous queue item — a no-op at the first item. */
export function playerPrev() {
  if (!current || current.index === 0) return;
  current = { ...current, index: current.index - 1 };
  emit();
}

export function usePlayerQueue(): PlayerQueue | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => null,
  );
}
