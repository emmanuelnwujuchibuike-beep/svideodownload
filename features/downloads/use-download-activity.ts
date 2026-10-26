"use client";

import { useSyncExternalStore } from "react";

import { getCompletedCount, getSnapshot, subscribe } from "@/features/downloads/manager";

/**
 * Has this tab had any download yet — a task in the list, or one completed earlier this session?
 *
 * Gates MOUNTING the floating progress card (2026-10-26). The card is code-split, but a code-split
 * component still downloads its code the moment it renders — and the paste box rendered it on every
 * visit, so every landing and downloader page fetched it and framer-motion (121 kB) while still loading,
 * to show nothing. Nothing the card shows exists before a task does: the progress, the finished card,
 * and the rating prompt (which needs a completed download).
 */
const hasActivity = () => getSnapshot().length > 0 || getCompletedCount() > 0;

export function useHasDownloadActivity(): boolean {
  return useSyncExternalStore(subscribe, hasActivity, () => false);
}

/** Start fetching the card's code before the first download needs it (a paste, a fetch). */
export function warmFloatingProgress(): void {
  void import("@/features/downloads/floating-progress").catch(() => {});
}
