"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether the top nav is currently hidden (scrolled away on mobile). A tiny
 * external store rather than context — `AppTopbar` (the writer) and any
 * sticky element that needs to shift up to fill the gap it leaves (the
 * reader, e.g. the feed's segmented control) live far apart in the tree.
 */
let hidden = false;
let locked = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function setTopbarHidden(next: boolean) {
  if (hidden === next) return;
  hidden = next;
  emit();
}

/**
 * Pages with their own sticky chrome (the feed's For You/Following bar) lock
 * the topbar visible: with the topbar static, the sticky bar below it sticks
 * at ONE position and never slides around while scrolling — the owner-specified
 * "fixed once it touches the top, never moving unnecessarily" behavior.
 * Counted (not boolean) so overlapping lockers compose safely.
 */
export function lockTopbarVisible(): () => void {
  locked += 1;
  emit();
  return () => {
    locked = Math.max(0, locked - 1);
    emit();
  };
}

/** Read inside scroll handlers (always current, no stale closure). */
export function isTopbarLocked(): boolean {
  return locked > 0;
}

export function useTopbarLocked(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => locked > 0,
    () => false,
  );
}

export function useTopbarHidden(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => hidden,
    () => false,
  );
}
