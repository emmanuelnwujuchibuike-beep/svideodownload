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
/*
  🔴 The fallback is DOWNLOADER, and it must match `normalizeMode` exactly
  (owner, 2026-08-09: "when a user signs in or logs in, they still land on full
  bleed and the home page becomes the download page, which is wrong").

  That is precisely what two disagreeing defaults produce. `normalizeMode` — the
  one the edge middleware routes on — treats an absent cookie as "downloader",
  so the server correctly turned `/` into the download page. These two lines
  still said "full", so the client chrome rendered Full Bleed navigation around
  it. A member with no cookie got downloader ROUTING inside full-bleed CHROME:
  each half behaving exactly as written, and the combination nonsense.

  There is now one default, expressed once. `normalizeMode(null)` is the only
  thing either side may fall back to, so the two cannot drift apart again.
*/
const DEFAULT_MODE: AppMode = normalizeMode(null);

const getSnapshot = (): AppMode => optimistic ?? readModeCookie() ?? readModeLS() ?? DEFAULT_MODE;

export function useAppMode(): AppMode {
  // The server-render snapshot has to agree with the client's first read, or
  // React swaps the whole shell out on hydration — a visible flash of the wrong
  // navigation on the first paint after signing in.
  return useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_MODE);
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
