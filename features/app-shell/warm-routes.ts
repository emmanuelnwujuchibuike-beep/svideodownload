/**
 * The bottom nav's idle warm-up for a SIGNED-OUT visitor: the public tabs a
 * guest actually has (Earn, History, Support, Profile's /profile doorway).
 * Members keep the owner's list in mobile-nav.tsx. Plain .ts so tests can
 * import it without a JSX transform.
 */
export const GUEST_WARM_ROUTES = ["/history", "/quests", "/support", "/profile"] as const;

/**
 * Warmed FIRST, the moment the nav mounts — everything else waits for the page
 * to finish loading (afterPageLoad).
 *
 * MEASURED 2026-10-10 (cold landing, iPhone 13, 4x CPU, 1.6 Mbps, tap at 5 s,
 * n=6): History took 5.6 s to paint because its prefetch was issued LAST —
 * after every visible tab and link had viewport-prefetched its own route and
 * JavaScript — so its page chunk did not even start downloading until 6.5 s
 * after the tap. Blocking those other prefetches alone took it to 2.7 s.
 * Nothing loses its warm-up; History just stops queueing behind the rest.
 */
export const FIRST_WARM_ROUTE = "/history";

/** Run `fn` once the page has loaded and the browser is idle. Returns a cancel. */
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
  if (document.readyState === "complete") go();
  else window.addEventListener("load", go, { once: true });
  return () => {
    cancelled = true;
    window.removeEventListener("load", go);
    if (idleId !== null) w.cancelIdleCallback?.(idleId);
    if (timer) clearTimeout(timer);
  };
}

/** The desktop sidebar's idle warm-up for a signed-out visitor: its public links. */
export const SIDEBAR_GUEST_WARM_ROUTES = ["/reels", "/sounds"] as const;
