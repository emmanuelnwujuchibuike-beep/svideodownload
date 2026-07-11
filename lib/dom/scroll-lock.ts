/**
 * Reader for the body-scroll-lock convention used across every fullscreen
 * viewer/modal in the app (reel/image/post viewers, sheets, recorders, etc.)
 * — each sets `document.body.style.overflowY = "hidden"` (never the
 * `overflow` shorthand, which would also block horizontal scroll) while
 * open, and restores the previous value on close. That convention is
 * enforced by hand at ~14 call sites today, not by a shared setter — this
 * only gives new code (features/app-shell/edge-swipe-back.tsx) a named,
 * documented function to depend on instead of a magic string comparison
 * inlined at each reader. Migrating the 14 existing lock/unlock sites onto a
 * shared setter is a larger, separate cleanup (tracked in project memory),
 * not done here.
 */
export function isBodyScrollLocked(): boolean {
  return typeof document !== "undefined" && document.body.style.overflowY === "hidden";
}
