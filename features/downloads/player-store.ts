"use client";

import { useSyncExternalStore } from "react";

import type { DownloadRecord } from "@/types";

/** Global "now playing" state for the in-browser download player. */
let current: DownloadRecord | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

export function openPlayer(rec: DownloadRecord) {
  current = rec;
  emit();
}
export function closePlayer() {
  current = null;
  emit();
}
export function usePlayer(): DownloadRecord | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => null,
  );
}
