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

/**
 * Owner rule CHANGED BACK 2026-08-16: a brand-new visitor once again defaults
 * to SYSTEM, not light (reverses the 2026-07-16 change below, kept for the
 * record rather than deleted — it explains why "light" isn't the naive
 * starting point). That earlier switch to "light" was a real fix for a real
 * bug: next-themes' own injected no-flash script does an unconditional LIVE
 * `matchMedia` read whenever ITS OWN storage key is empty/"system", which
 * silently overwrote this app's boot-time resolution for anyone still on the
 * default. Removing "system" as the default removed that disagreement, at
 * the cost of a brand-new visitor never seeing their OS preference until they
 * opened the toggle and picked it themselves.
 *
 * The bug's actual fix, added the same 2026-07-16 pass and UNCHANGED here, is
 * `syncNextThemes()` in boot-splash.tsx's THEME_JS: whenever this app's own
 * intent resolves to a concrete light/dark — including when that resolution
 * started from "system" — it writes that CONCRETE value into next-themes'
 * `theme` key before next-themes' script ever runs, so next-themes never
 * actually sees the literal string "system" and never takes its live-query
 * branch. That mechanism is what actually prevents the disagreement, and it
 * works identically regardless of what the DEFAULT mode is — "light" was
 * removing the symptom, not the cause. Restoring "system" as the default now
 * exercises the same already-hardened resolution path every returning
 * System-mode visitor already exercises on every load; it does not reopen the
 * hole the original fix closed.
 *
 * `localStorage.setItem` HERE, not just an in-memory fallback: the owner
 * asked the choice be "saved on local storage" on a visitor's first entry,
 * not merely assumed each session — so a fresh visitor's `frenz-theme-mode`
 * key becomes a real, persisted "system" on their very first read rather than
 * staying absent forever (which would have made the toggle unable to tell "no
 * one has ever chosen" apart from "chose system").
 *
 * There are THREE layers that each independently decide this, and they must
 * agree or the theme flashes on boot — the exact failure the 2026-07-16 rule
 * was reacting to. All three are set to system:
 *   1. here (`readInitial`)                — React-side intent
 *   2. boot-splash.tsx THEME_JS `mode()`   — the pre-paint <head> script
 *   3. app/layout.tsx `defaultTheme`       — next-themes' own fallback
 */
function readInitial(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
    localStorage.setItem(KEY, "system");
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
