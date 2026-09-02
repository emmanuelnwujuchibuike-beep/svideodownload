/**
 * Blocks pop-unders and click-direct opened by third-party ad scripts.
 *
 * 🔴 PURE + a small runtime installer. No React, no Supabase.
 *
 * ── Why this exists ─────────────────────────────────────────────────────
 * Owner, 2026-09-02: "disable hiltop popunder that is included in video slider,
 * the click direct should be block, only the video and impression and
 * intentional clicl ctr and cpm, i dont want hiltop popunder to cause harm to my
 * adsense newly application."
 *
 * HilltopAds' MultiTag video slider is one script that can carry more than the
 * player. The pop-under half binds a handler that opens a window on the
 * visitor's NEXT CLICK ANYWHERE — including a click on our own Download button.
 * That is the single most AdSense-hostile behaviour on a page: unrequested
 * windows, navigation the visitor did not ask for, and it happens on the same
 * pages Google's inventory runs on.
 *
 * ── Why an allow-list, not a block-list ─────────────────────────────────
 * The obvious rule — "block opens with no user gesture" — does not work here,
 * because a pop-under fires ON a real gesture. It rides the visitor's genuine
 * click, so from the browser's point of view it is as trusted as ours.
 *
 * What actually separates them is INTENT, and only our own code knows that. So
 * `window.open` is closed by default and our six legitimate call sites announce
 * themselves first via `allowWindowOpen()`. Anything that did not announce
 * itself — which is every third-party script by construction — gets null back.
 *
 * ── What this does NOT claim ────────────────────────────────────────────
 * It is not a sandbox. A determined script could navigate the top frame by
 * assigning `location`, and blocking that would mean breaking our own router.
 * This closes the pop-under/new-window vector specifically, which is the one
 * the owner asked about and the one a policy reviewer would see. Nothing here
 * should be described as "Hilltop is now AdSense-compliant" — it is one
 * behaviour contained, verifiable by the counter below.
 */

/** How long an announced open stays valid. Long enough for an await, short
 *  enough that it cannot be borrowed by a later script. */
const ALLOW_WINDOW_MS = 1000;

interface GuardState {
  allowUntil: number;
  /** Opens refused. Exposed for verification — see `popunderGuardStats`. */
  blocked: number;
  allowed: number;
  installed: boolean;
}

const state: GuardState = { allowUntil: 0, blocked: 0, allowed: 0, installed: false };

/**
 * The decision, isolated so it can be tested without a DOM.
 *
 * `now <= allowUntil` and nothing else: an open is permitted only inside the
 * window our own code opened for it.
 */
export function shouldAllowOpen(now: number, allowUntil: number): boolean {
  return now <= allowUntil;
}

/**
 * Announce a legitimate `window.open` about to happen.
 *
 * Call immediately before opening. Every one of our own call sites does — an
 * ad's own click-through included, because an intentional click on an ad is a
 * real click the network should be paid for. This blocks pop-unders, not
 * advertising.
 */
export function allowWindowOpen(): void {
  state.allowUntil = Date.now() + ALLOW_WINDOW_MS;
}

/** Refused/permitted counts, so the guard can be verified rather than believed. */
export function popunderGuardStats(): { blocked: number; allowed: number; installed: boolean } {
  return { blocked: state.blocked, allowed: state.allowed, installed: state.installed };
}

/** Test seam. */
export function __resetPopunderGuard(): void {
  state.allowUntil = 0;
  state.blocked = 0;
  state.allowed = 0;
}

/**
 * Install the guard. Idempotent, and safe to call before any ad script loads —
 * which is the point: it must be in place BEFORE the network's handler binds.
 */
export function installPopunderGuard(): void {
  if (typeof window === "undefined" || state.installed) return;
  state.installed = true;

  const native = window.open.bind(window);

  window.open = function guardedOpen(
    url?: string | URL,
    target?: string,
    features?: string,
  ): Window | null {
    if (!shouldAllowOpen(Date.now(), state.allowUntil)) {
      state.blocked += 1;
      /*
        Returning null rather than throwing. A pop-under script that throws can
        break the rest of its own bundle — including the video player we DO want
        — and a null return is what a browser's own popup blocker gives, so any
        script worth trusting already handles it.
      */
      return null;
    }
    // Consume the permission: one announcement, one open.
    state.allowUntil = 0;
    state.allowed += 1;
    return native(url as string, target as string, features as string);
  } as typeof window.open;
}
