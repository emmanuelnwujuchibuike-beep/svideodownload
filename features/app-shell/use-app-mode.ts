"use client";

import { useSyncExternalStore } from "react";

import { APP_MODE_COOKIE, type AppMode, normalizeMode } from "@/lib/app-mode";

/** Durable localStorage backup of the mode, so it survives a lost/expired cookie
 *  across cold entries (owner: "save last mode to local storage so … cold entry
 *  doesn't show the feed homepage that is in full bleed"). */
const MODE_LS_KEY = "frenz_mode";

function readModeCookie(): AppMode | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|;\s*)frenz_mode=([^;]+)/);
  const val = m?.[1];
  return val ? normalizeMode(decodeURIComponent(val)) : null;
}
function readModeLS(): AppMode | null {
  try {
    const v = localStorage.getItem(MODE_LS_KEY);
    return v ? normalizeMode(v) : null;
  } catch {
    return null;
  }
}
function writeCookie(mode: AppMode): void {
  try {
    const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${APP_MODE_COOKIE}=${mode}; path=/; max-age=31536000; samesite=lax${secure}`;
  } catch {
    /* cookies blocked */
  }
}

// On load, if the cookie is gone but localStorage remembers a non-default mode,
// restore the cookie so the edge middleware routes correctly on the next
// navigation — the cookie is the routing source of truth, localStorage its backup.
if (typeof document !== "undefined") {
  if (readModeCookie() === null) {
    const ls = readModeLS();
    if (ls && ls !== "full") writeCookie(ls);
  }
}

const listeners = new Set<() => void>();
let optimistic: AppMode | null = null;
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getSnapshot = (): AppMode => optimistic ?? readModeCookie() ?? readModeLS() ?? "full";

export function useAppMode(): AppMode {
  return useSyncExternalStore(subscribe, getSnapshot, () => "full");
}

/**
 * Switch the experience mode. Writes BOTH the cookie (edge routing) and
 * localStorage (durable backup), then hard-navigates to the mode's home so the
 * whole tree re-renders — Full Bleed → the app home; Downloader → the signed-in
 * download page. A hard navigation is deliberate: the mode changes server-side
 * routing, so the document must be re-fetched. (No F loader on this — it's removed
 * from the website entirely; see boot-splash.tsx.)
 */
export function setAppMode(mode: AppMode): void {
  writeCookie(mode);
  try {
    localStorage.setItem(MODE_LS_KEY, mode);
  } catch {
    /* storage blocked — the cookie still applies it */
  }
  optimistic = mode;
  for (const l of listeners) l();
  window.location.assign(mode === "downloader" ? "/downloads" : "/home");
}
