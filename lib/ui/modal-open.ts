/**
 * One full-screen dialog at a time (owner, 2026-10-10, screenshot: the paid
 * Samsung interstitial and the "Earn credits" promo open on top of each other).
 *
 * Each overlay used to decide on its own timer, so two could land in the same
 * second. Anything that opens a full-screen moment asks this first: a visible
 * `role="dialog"` with `aria-modal="true"` already on screen means "not now".
 * Reading the DOM, not a registry, means overlays that predate this rule are
 * respected too. A dialog kept mounted but hidden (no layout box) does not count.
 */
export function anotherModalOpen(except?: Element | null): boolean {
  if (typeof document === "undefined") return false;
  for (const el of document.querySelectorAll('[role="dialog"][aria-modal="true"]')) {
    if (el === except) continue;
    if (el.getClientRects().length > 0) return true;
  }
  return false;
}
