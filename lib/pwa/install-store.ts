"use client";

/**
 * The `beforeinstallprompt` holding pen — the ONLY part of the Smart Install
 * system that runs on a cold landing load.
 *
 * ── Why a module-level store and not a hook ───────────────────────────────────
 * Chromium fires `beforeinstallprompt` once, early, and usually before any
 * component that cares has mounted. Miss it and the browser never offers it
 * again for that page load, which is exactly how an "Install" button ends up
 * falling back to manual instructions on a browser that could have done it
 * natively. So the listener is attached at import time, module scope, and the
 * event is parked here until something asks for it.
 *
 * ── Why it is this small ──────────────────────────────────────────────────────
 * `/(marketing)/page` is measured against a 275 kB gzipped ceiling
 * (lib/perf/budget.test.ts) and sits at ~264 kB. Everything the install feature
 * knows — browser detection, the per-browser instructions, the modal itself —
 * lives in a chunk that is only fetched when someone actually taps Install.
 * What has to be eager is just this: two `addEventListener` calls and a boolean.
 *
 * No polling, no interval, no rAF, no observer, no UA parsing. Two passive
 * event listeners for the life of the document, which is the cheapest thing
 * that can still be correct.
 *
 * ── Relationship to features/notifications/ios-install-prompt.tsx ─────────────
 * That component is the AUTOMATIC banner (app-shell only, dynamically imported,
 * never on the landing) and keeps its own listener. This store is deliberately
 * additive rather than a refactor of it: a DOM event is delivered to every
 * registered listener independently, so both see it and neither breaks. The one
 * shared consequence is that a prompt can only be consumed once — whichever
 * surface the person actually used wins, and the other hides itself on
 * `appinstalled` anyway. Rewiring that working flow to depend on this new
 * module would put an existing, shipped install path at risk for no user-facing
 * gain.
 */

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export interface InstallState {
  /** A real native install prompt is parked and ready to fire. */
  canPrompt: boolean;
  /** `appinstalled` fired during this page load. */
  installed: boolean;
}

let deferred: BeforeInstallPromptEvent | null = null;
/* Cached so `useSyncExternalStore` sees a stable reference between renders —
   returning a fresh object every call is an infinite re-render loop. */
let state: InstallState = { canPrompt: false, installed: false };
const listeners = new Set<() => void>();

function set(next: InstallState): void {
  state = next;
  for (const l of listeners) l();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    // Suppress Chrome's own mini-infobar so the install happens on OUR button,
    // at a moment the person chose, rather than as a browser interruption.
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    set({ canPrompt: true, installed: state.installed });
  });

  window.addEventListener("appinstalled", () => {
    deferred = null;
    set({ canPrompt: false, installed: true });
  });
}

export function subscribeInstall(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getInstallState(): InstallState {
  return state;
}

/** Server snapshot — nothing is installable during SSR, and this must be a
 *  stable reference for the same reason `state` is. */
const SERVER_STATE: InstallState = { canPrompt: false, installed: false };
export function getServerInstallState(): InstallState {
  return SERVER_STATE;
}

/**
 * Fire the real native install prompt. Resolves to the user's choice, or
 * `"unavailable"` when there was no parked event to fire.
 *
 * The event is cleared either way: a `BeforeInstallPromptEvent` is single-use,
 * and keeping a spent one around would leave the button claiming a native
 * install it can no longer perform.
 */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const evt = deferred;
  if (!evt) return "unavailable";
  deferred = null;
  set({ canPrompt: false, installed: state.installed });
  try {
    await evt.prompt();
    const { outcome } = await evt.userChoice;
    return outcome;
  } catch {
    return "unavailable";
  }
}
