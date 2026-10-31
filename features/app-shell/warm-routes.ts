/**
 * The bottom nav's idle warm-up for a SIGNED-OUT visitor: the public tabs a
 * guest actually has (History, Profile's /profile doorway).
 * Members keep the owner's list in mobile-nav.tsx. Plain .ts so tests can
 * import it without a JSX transform.
 */
// /messages (static) and /friends (static for a guest — middleware rewrites it to app/(app)/guest/friends) joined
// 2026-10-31: the owner saw the stripe loader on a guest's Chats and Friends taps; warmed after load, they open at once
export const GUEST_WARM_ROUTES = ["/history", "/profile", "/messages", "/friends"] as const;

/**
 * Warmed FIRST once the page has loaded (afterPageLoad) — ahead of every other tab.
 * Since 2026-10-27 not at mount: that competed with the cold entry page itself.
 *
 * MEASURED 2026-10-10 (cold landing, iPhone 13, 4x CPU, 1.6 Mbps, tap at 5 s,
 * n=6): History took 5.6 s to paint because its prefetch was issued LAST —
 * after every visible tab and link had viewport-prefetched its own route and
 * JavaScript — so its page chunk did not even start downloading until 6.5 s
 * after the tap. Blocking those other prefetches alone took it to 2.7 s.
 * Nothing loses its warm-up; History just stops queueing behind the rest.
 */
export const FIRST_WARM_ROUTE = "/history";

/** The latest the warm-up waits after the page shows (see afterPageLoad). */
export const WARM_AFTER_MS = 1000;

/** Run `fn` once the page has loaded (or a second has passed, or the first touch) and the browser is idle. Returns a cancel. */
export function afterPageLoad(fn: () => void): () => void {
  let cancelled = false;
  let idleId: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
  const go = () => {
    if (cancelled) return;
    if (w.requestIdleCallback) idleId = w.requestIdleCallback(() => !cancelled && fn(), { timeout: 2000 });
    else timer = setTimeout(() => !cancelled && fn(), 300);
  };
  /*
    Owner, 2026-10-28: "the Friends navigation and other navigation now load on tap instead of opening instantly".
    `load` waits for EVERY image and ad on the page — many seconds on /downloads — so the tabs were often not warm
    yet when tapped. Now whichever comes first: the load, WARM_AFTER_MS after the page shows (the first screen has had
    the connection to itself by then), or the member's first touch. Runs once.
  */
  let fallback: ReturnType<typeof setTimeout> | null = null;
  let started = false;
  const once = () => {
    if (started) return;
    started = true;
    window.removeEventListener("load", once);
    window.removeEventListener("pointerdown", once, true);
    if (fallback) clearTimeout(fallback);
    go();
  };
  if (document.readyState === "complete") once();
  else {
    window.addEventListener("load", once, { once: true });
    window.addEventListener("pointerdown", once, { capture: true, once: true, passive: true });
    fallback = setTimeout(once, WARM_AFTER_MS);
  }
  return () => {
    cancelled = true;
    if (fallback) clearTimeout(fallback);
    window.removeEventListener("load", once);
    window.removeEventListener("pointerdown", once, true);
    if (idleId !== null) w.cancelIdleCallback?.(idleId);
    if (timer) clearTimeout(timer);
  };
}

/** The desktop sidebar's idle warm-up for a signed-out visitor: its public links. */
export const SIDEBAR_GUEST_WARM_ROUTES = ["/reels", "/sounds"] as const;
