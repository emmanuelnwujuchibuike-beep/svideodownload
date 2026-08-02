"use client";

import { useSyncExternalStore } from "react";

import { APP_MODE_COOKIE, type AppMode, normalizeMode } from "@/lib/app-mode";

/** Read the mode from the cookie (the source of truth). */
function readModeCookie(): AppMode {
  if (typeof document === "undefined") return "full";
  const m = document.cookie.match(/(?:^|;\s*)frenz_mode=([^;]+)/);
  const val = m?.[1];
  return normalizeMode(val ? decodeURIComponent(val) : null);
}

const listeners = new Set<() => void>();
// Set optimistically the instant a toggle fires, so any chrome that reads the
// mode updates before the hard navigation completes.
let optimistic: AppMode | null = null;
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getSnapshot = (): AppMode => optimistic ?? readModeCookie();

export function useAppMode(): AppMode {
  return useSyncExternalStore(subscribe, getSnapshot, () => "full");
}

/**
 * Switch the experience mode. Writes the cookie (which drives middleware routing
 * AND every server render's chrome) then HARD-navigates to the mode's home so the
 * whole tree re-renders under the new mode — Full Bleed → the app home; Downloader
 * → the personalized landing. A hard navigation (not a client push) is deliberate:
 * the mode changes server-side routing, so the document must be re-fetched.
 */
export function setAppMode(mode: AppMode): void {
  try {
    document.cookie = `${APP_MODE_COOKIE}=${mode}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    /* cookies blocked — the navigation below still applies it for this load */
  }
  optimistic = mode;
  for (const l of listeners) l();
  window.location.assign(mode === "downloader" ? "/" : "/home");
}
