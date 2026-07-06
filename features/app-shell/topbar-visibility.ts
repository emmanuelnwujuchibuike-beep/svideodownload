"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether the top nav is currently hidden (scrolled away on mobile). A tiny
 * external store rather than context — `AppTopbar` (the writer) and any
 * sticky element that needs to shift up to fill the gap it leaves (the
 * reader, e.g. the feed's segmented control) live far apart in the tree.
 */
let hidden = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function setTopbarHidden(next: boolean) {
  if (hidden === next) return;
  hidden = next;
  emit();
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
