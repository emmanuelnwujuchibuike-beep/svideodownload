import { allowWindowOpen } from "./popunder-guard";

/**
 * Watches `window.open` for the spot pop-under (Part 2.1) — WITHOUT blocking other scripts.
 *
 * The earlier version installed the pop-under GUARD (popunder-guard.ts) on every page that carried
 * a spot, which refused every unannounced window there — other ad networks' included. This one only
 * counts: a window opened by a script that is not ours (the Monetag pop-under) is recorded, so the
 * direct link knows the pop-under showed and stays shut.
 *
 * It refuses exactly one thing: for a moment right after OUR direct link opened (`suppressForeignOpens`),
 * a foreign window — a pop-under arriving late on that same tap — so the two never both show. That is
 * the whole interception: ~1.5 s, only after a tap at a configured spot opened the direct link.
 *
 * Composes with the guard where it is installed (Hilltop pages): our own opens are announced to it.
 */

const state = { installed: false, foreignOpened: 0, suppressUntil: 0, suppressed: 0, own: false };

export function installOpenObserver(): void {
  if (typeof window === "undefined" || state.installed) return;
  state.installed = true;
  const prev = window.open.bind(window);
  window.open = function observedOpen(url?: string | URL, target?: string, features?: string): Window | null {
    if (!state.own && Date.now() < state.suppressUntil) {
      state.suppressed += 1;
      return null;
    }
    const w = prev(url as string, target as string, features as string);
    // a browser's own popup blocker returns null: that is NOT a pop-under that showed
    if (w && !state.own) state.foreignOpened += 1;
    return w;
  } as typeof window.open;
}

/** Windows other scripts really opened (non-null), since the page loaded. */
export function foreignOpenCount(): number {
  return state.foreignOpened;
}

/** Open OUR link in a new tab (announced to the guard where it is installed). */
export function openOwnWindow(url: string): void {
  state.own = true;
  try {
    allowWindowOpen();
    window.open(url, "_blank", "noopener,noreferrer");
  } finally {
    state.own = false;
  }
}

/** After our direct link opened: refuse foreign windows for `ms` (a late pop-under on the same tap). */
export function suppressForeignOpens(ms: number): void {
  state.suppressUntil = Date.now() + ms;
}

export function openObserverStats(): { installed: boolean; foreignOpened: number; suppressed: number } {
  return { installed: state.installed, foreignOpened: state.foreignOpened, suppressed: state.suppressed };
}
