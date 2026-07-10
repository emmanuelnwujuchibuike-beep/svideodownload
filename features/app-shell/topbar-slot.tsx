"use client";

import { useSyncExternalStore, type ReactNode } from "react";

/**
 * Lets a page inject content into the CENTER of the shared `AppTopbar` — used
 * by the feed to lift its For You / Following / Reels control up into the top
 * nav. A tiny external store (same pattern as `topbar-visibility.ts`): the
 * writer (the feed) and the reader (`AppTopbar`) live far apart in the tree,
 * and only ONE page at a time ever owns the slot (the feed sets it on mount,
 * clears it on unmount) — every other page's topbar is untouched.
 */
let node: ReactNode = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function setTopbarCenter(next: ReactNode) {
  node = next;
  emit();
}

export function useTopbarCenter(): ReactNode {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => node,
    () => null,
  );
}
