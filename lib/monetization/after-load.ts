/**
 * Run something only once the page has finished loading, and the browser is idle.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────
 *
 * Owner, 2026-09-01, with a Lighthouse run: "in everything we have done, i think
 * we have broken the lcp". Measured on production at slow-4G + 4x CPU, and they
 * were right:
 *
 *     FCP 5432ms   LCP 8112ms
 *     third-party requests during load: massivesalad.com x5
 *
 * Five HilltopAds requests were being made WHILE THE PAGE WAS STILL LOADING. The
 * site-wide video slider injected its script the moment its config arrived, and
 * the lazy slots' safety timer could fire before `load` — so third-party
 * JavaScript was parsing and executing on the main thread in the window that
 * decides LCP, on the one route held to a 1.6s budget.
 *
 * 🔴 THIS IS A STANDING LAW IN THIS CODEBASE, not a new idea: ad creatives wait
 * for `load`, recorded after the same mistake cost ~340ms of LCP on 2026-08-30.
 * The HilltopAds units were written without it.
 *
 * ── Why `load` AND idle ───────────────────────────────────────────────────────
 *
 * `load` alone still lands the work in the first quiet moment after the page
 * settles, which on a slow phone is exactly when the main thread is catching up
 * on everything it deferred. The idle callback puts it after that too, with a
 * timeout so it cannot be starved forever on a busy page.
 */
export function afterLoadIdle(run: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  let cancelled = false;
  let idleHandle: number | undefined;

  const schedule = () => {
    if (cancelled) return;
    const ric = (window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    }).requestIdleCallback;
    if (ric) {
      idleHandle = ric(() => {
        if (!cancelled) run();
      }, { timeout: 3000 });
      return;
    }
    // Safari has no idle callback. A short timer is the same intent.
    idleHandle = window.setTimeout(() => {
      if (!cancelled) run();
    }, 1200);
  };

  if (document.readyState === "complete") {
    schedule();
    return () => {
      cancelled = true;
    };
  }

  window.addEventListener("load", schedule, { once: true });
  return () => {
    cancelled = true;
    window.removeEventListener("load", schedule);
    if (idleHandle !== undefined) window.clearTimeout(idleHandle);
  };
}
