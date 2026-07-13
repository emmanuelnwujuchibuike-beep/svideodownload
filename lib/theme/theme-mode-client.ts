"use client";

export type ThemeMode = "light" | "dark" | "system";

const KEY = "frenz-theme-mode";

/**
 * The user's actual theme INTENT (light/dark/"follow system"), separate from
 * next-themes' own `theme` storage key — which this app now always keeps a
 * concrete "light"/"dark" in, never the literal string "system" (see
 * boot-splash.tsx's THEME_JS for why: next-themes' own injected no-flash
 * script does a LIVE `matchMedia` query whenever its storage key resolves to
 * "system", unconditionally, with no way to opt out via props — that
 * overwrote this app's cached-resolved-theme boot fix on every load for
 * anyone on the (default) System setting). `ThemeToggle` reads/writes this
 * key to know which segment is actually selected instead of next-themes'
 * `theme`, which no longer carries that information.
 */
let current: ThemeMode = readInitial();
const listeners = new Set<(mode: ThemeMode) => void>();

function readInitial(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* storage blocked */
  }
  return "system";
}

export function getCachedThemeMode(): ThemeMode {
  return current;
}

export function subscribeThemeMode(listener: (mode: ThemeMode) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setThemeModeLocal(mode: ThemeMode): void {
  current = mode;
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* storage blocked — still updates in-memory/React state for this tab */
  }
  for (const l of listeners) l(current);
}
