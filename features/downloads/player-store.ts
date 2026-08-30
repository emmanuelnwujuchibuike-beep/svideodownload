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
  // Clearing this matters: a latched ad would otherwise re-appear over the
  // next queue the visitor opens.
  adPending = false;
  emit();
}

/** MANUAL advance to the next queue item (a tap-right); no-op at the last item so
 *  a tap never dismisses the player. Does NOT tick the clip-ended counter. */
export function playerNext() {
  if (!current || current.index >= current.items.length - 1) return;
  // A story ad may take this advance instead — see advanceWithAd.
  if (advanceWithAd()) return;
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
    // Same ad gate as a manual tap, so the rhythm is "3 media then an ad"
    // however the visitor got there.
    if (advanceWithAd()) return;
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

/* ─────────────────────── Story ads between queue items ─────────────────────
   Owner, 2026-08-30: "after 3 media, the next should be a vertical full screen
   video ad … can be next by left tap but center tap opens the ad link."

   🔴 THE AD IS NOT A QUEUE ENTRY, and that is the whole design.

   The obvious implementation — splice ad slides into `items` — is the one that
   broke Reels three times: `index` then means a SLIDE position while every
   caller still reads it as an ITEM position, and the two silently disagree.
   This queue has four consumers (history, Continue Watching, the review player,
   the floating card), so that bug would have four places to surface.

   Instead `items` and `index` keep their exact current meaning and the ad is a
   FLAG that gates the advance. Nothing that reads the queue today changes.

   Scoped by `adEvery`, which only the history gallery sets — the other three
   surfaces open queues with it undefined and never see an ad. */

/** After how many items an ad shows. 0/undefined = never (the default). */
let adEvery = 0;
/** True while a story ad is on screen, holding the advance. */
let adPending = false;
/** Advances already paid for, so going back and forth cannot replay one. */
const adShownAt = new Set<number>();

/** Open a queue that shows a story ad after every `every` items. */
export function openPlayerQueueWithAds(
  items: DownloadRecord[],
  startIndex: number,
  every: number,
) {
  adEvery = Math.max(0, Math.floor(every));
  adPending = false;
  adShownAt.clear();
  openPlayerQueue(items, startIndex);
}

/** Is a story ad currently on screen? */
export function isPlayerAdPending(): boolean {
  return adPending;
}

/**
 * Should moving to `nextIndex` be interrupted by an ad?
 *
 * Counted on the DESTINATION so the rhythm is "3 media, then an ad", and
 * latched per position so a visitor tapping back and forth over the same
 * boundary is not shown the same ad repeatedly.
 */
function adDueAt(nextIndex: number): boolean {
  if (adEvery <= 0 || adPending) return false;
  if (nextIndex <= 0 || nextIndex >= (current?.items.length ?? 0)) return false;
  if (adShownAt.has(nextIndex)) return false;
  return nextIndex % adEvery === 0;
}

/** Dismiss the story ad and complete the advance it was holding. */
export function playerAdDone() {
  if (!adPending) return;
  adPending = false;
  if (current && current.index < current.items.length - 1) {
    current = { ...current, index: current.index + 1 };
  }
  emit();
}

/**
 * The advance used by BOTH a tap and a natural clip end, with the ad check.
 *
 * Returns true when an ad took over instead of advancing, so the caller knows
 * the queue did not move.
 */
function advanceWithAd(): boolean {
  if (!current) return false;
  const next = current.index + 1;
  if (!adDueAt(next)) return false;
  adShownAt.add(next);
  adPending = true;
  emit();
  return true;
}

/** Re-renders a component when a story ad opens or closes. */
export function usePlayerAdPending(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => adPending,
    () => false,
  );
}
