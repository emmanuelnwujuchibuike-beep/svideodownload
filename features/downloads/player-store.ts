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

// A monotonic count of clips that FINISHED playing (played to the end) this
// session, with its own listener set. The download interstitial fires "after the
// 3rd video ends going to the next" (owner) — so only a natural end ticks this,
// NOT opening the player or tapping prev/next, which used to inflate the count and
// made the ad appear mid-navigation.
let watchCount = 0;
const watchListeners = new Set<() => void>();
function countClipEnded() {
  watchCount += 1;
  for (const l of watchListeners) l();
}
/** Total clips that finished playing this session (never decremented). */
export function getWatchCount(): number {
  return watchCount;
}
/** Subscribe to "a clip finished playing" — fired only on a natural end/advance. */
export function onVideoWatched(cb: () => void): () => void {
  watchListeners.add(cb);
  return () => watchListeners.delete(cb);
}

/** Whether the review player is currently open — used by the interstitials so an
 *  idle/download ad never pops over a clip the visitor is actively watching. */
export function isPlayerOpen(): boolean {
  return current !== null;
}

/** Open a single item with no queue context (e.g. from the Downloads list). */
export function openPlayer(rec: DownloadRecord) {
  current = { items: [rec], index: 0 };
  emit();
}

/** Open a queue (Continue Watching's row) seeded at whichever item was tapped. */
export function openPlayerQueue(items: DownloadRecord[], startIndex = 0) {
  if (items.length === 0) return;
  current = { items, index: Math.max(0, Math.min(items.length - 1, startIndex)) };
  emit();
}

export function closePlayer() {
  current = null;
  emit();
}

/** MANUAL advance to the next queue item (a tap-right); no-op at the last item so
 *  a tap never dismisses the player. Does NOT tick the clip-ended counter. */
export function playerNext() {
  if (!current || current.index >= current.items.length - 1) return;
  current = { ...current, index: current.index + 1 };
  emit();
}

/** A clip PLAYED TO THE END. Ticks the clip-ended counter (the interstitial's
 *  every-3rd beat), then auto-advances to the next clip — or closes the player if
 *  that was the last one. This is the ONLY path that counts toward the ad. */
export function playerClipEnded() {
  if (!current) return;
  countClipEnded();
  if (current.index < current.items.length - 1) {
    current = { ...current, index: current.index + 1 };
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
