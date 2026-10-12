"use client";

import { useSyncExternalStore } from "react";

/**
 * Is the Download page's sticky top banner ON SCREEN with a creative in it?
 *
 * The topbar slides away on /downloads only to give that banner the full width
 * (owner 2026-10-12). With no banner — a Pro or Business member, or a zone that
 * did not fill — there is nothing to make room for, so the bar must stay (owner
 * 2026-10-12: "shouldn't hide when there is no ad"). Same honest-fact pattern as
 * lib/dom/bottom-ad-bar.ts: the banner publishes, the topbar reads.
 */
let present = false;
const listeners = new Set<() => void>();

export function setTopAdPresent(next: boolean): void {
  if (next === present) return;
  present = next;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Server and first paint: no banner — the bar renders in place, so no mismatch. */
export function useTopAdPresent(): boolean {
  return useSyncExternalStore(subscribe, () => present, () => false);
}
