/**
 * A new deploy is applied on the member's NEXT TAP, never on entry, resume or back-swipe
 * (owner, 2026-10-15: "Make everything open instant, never reload on every entry or backswipe").
 *
 * The deploy check (features/notifications/register-sw.tsx) used to reload the page the moment
 * it noticed a new build — 4 s after opening the app, or on returning after a minute away. With
 * deploys landing several times a day, that was a reload on almost every entry. Now the new
 * build only waits; the next ordinary in-app link the member taps loads its destination as a
 * full page (the place they were going anyway), which brings the new build in with no extra
 * wait and no surprise. A chunk that vanished meanwhile is still recovered by the chunk-error
 * screen (features/app-shell/chunk-error.ts).
 *
 * Pure and DOM-free so the rule is testable: which clicks may carry the update.
 */

export interface ClickLike {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}

export interface AnchorLike {
  href: string;
  target: string;
  hasDownload: boolean;
}

/** Pages where a full load must never be forced (a sign-in mid-flow can hold a one-time code). */
const NEVER_ON = /^\/(login|auth)(\/|$)/;

/**
 * May this click on this link become a full page load of its destination? Only a plain
 * left-click on a same-origin page link that the app would navigate to anyway — never a new
 * tab, a download, an in-page #anchor, or another site.
 */
export function mayCarryUpdate(click: ClickLike, a: AnchorLike, here: { origin: string; pathname: string; search: string }): boolean {
  if (click.defaultPrevented || click.button !== 0) return false;
  if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return false;
  if (a.hasDownload || (a.target && a.target !== "_self")) return false;
  let url: URL;
  try {
    url = new URL(a.href, here.origin);
  } catch {
    return false;
  }
  if (url.origin !== here.origin || (url.protocol !== "https:" && url.protocol !== "http:")) return false;
  // a link to a spot on this same page is not a navigation
  if (url.pathname === here.pathname && url.search === here.search && url.hash) return false;
  if (NEVER_ON.test(here.pathname) || NEVER_ON.test(url.pathname)) return false;
  return true;
}
