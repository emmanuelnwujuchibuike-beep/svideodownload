/**
 * "If you go back from here, go HERE" — a one-slot override for the swipe-back
 * gesture, set by whichever page is currently on screen.
 *
 * ── 🔴 THE BUG THIS EXISTS TO KILL (owner, 2026-08-24) ────────────────────
 * "Backswipe from chat goes back to home feed, instead of to message page."
 *
 * Six entry points (the profile Message button, friends-hub, compose-launcher,
 * add-friend-button…) open a chat by pushing `/messages/new/<userId>`, which
 * SERVER-REDIRECTS to `/messages/<conversationId>`. A server redirect REPLACES
 * the history entry, so the `/messages/new/…` step disappears and history ends
 * up `[…, /home, /messages/<id>]` with no inbox behind the chat. `router.back()`
 * was then doing exactly what it was told — returning to the home feed.
 *
 * The gesture was never wrong; the history was. So the fix is for the chat to
 * declare where "back" means, rather than for the gesture to start guessing.
 *
 * ── Why a module slot and not a context/event ─────────────────────────────
 * `EdgeSwipeBack` is mounted once in the app shell, far above any page, and it
 * reads this at the moment a gesture COMPLETES — not during render. A context
 * would mean threading a provider through the shell for a value read outside
 * React's lifecycle; an event would mean a listener per page. This is the same
 * shape as `topbar-slot.ts` and `topbar-visibility.ts`, which already solve
 * "one page tells one piece of shell chrome something" in this codebase.
 *
 * 🔴 It holds a ROUTE, and nothing else. It does not patch `pushState`, does
 * not listen to `popstate`, and does not touch the router — the standing rule
 * against global runtime that interferes with navigation. The browser's own
 * back button still follows real history, which is correct: this overrides the
 * app's own gesture, not the platform's.
 */

let target: string | null = null;

/** Declare where the swipe-back gesture should land while this page is open. */
export function setBackTarget(href: string | null): void {
  target = href;
}

/**
 * Read and CLEAR the override. Consuming it is what stops a stale target
 * outliving the page that set it if a cleanup is ever missed — the failure
 * here would be a swipe on an unrelated page navigating somewhere surprising,
 * which is worse than the bug being fixed.
 */
export function takeBackTarget(): string | null {
  const value = target;
  target = null;
  return value;
}
