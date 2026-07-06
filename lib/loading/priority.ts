/**
 * Frenz Core · Loading Engine — priority scheduler.
 *
 * The app renders in layers (shell → skeleton → critical data → media →
 * background). These helpers are how features schedule the LAST layer:
 * work that must never compete with first paint or user input.
 *
 *   afterInteractive(() => prefetchSuggestions());   // idle-time work
 *   const stop = whenVisible(el, () => loadComments()); // viewport-gated work
 *
 * Rules (docs/FRENZ_CORE.md → Loading Architecture):
 *  - Anything not needed for the current viewport goes through one of these.
 *  - Both are cancel-safe: call the returned function on unmount.
 *  - Never busy-wait or poll; these ride the browser's own idle/visibility
 *    signals so background loading costs no battery and no jank.
 */

type Cancel = () => void;

/**
 * Runs `task` when the main thread is idle (after hydration + current
 * interactions), with a deadline so it still runs on busy low-end devices.
 * Returns a cancel function.
 */
export function afterInteractive(task: () => void, opts?: { timeout?: number }): Cancel {
  if (typeof window === "undefined") return () => {};
  const timeout = opts?.timeout ?? 2500;

  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(() => task(), { timeout });
    return () => window.cancelIdleCallback(id);
  }
  // Safari (no requestIdleCallback): a short macrotask delay lands after
  // hydration and the first paint without blocking either.
  const id = window.setTimeout(task, Math.min(timeout, 300));
  return () => window.clearTimeout(id);
}

/**
 * Runs `task` once when `el` approaches the viewport (default: 300px before
 * it's visible — content is ready by the time the user reaches it). Returns a
 * cancel function. Falls back to running immediately where IntersectionObserver
 * is unavailable (very old engines) so content is never permanently withheld.
 */
export function whenVisible(el: Element | null, task: () => void, opts?: { rootMargin?: string }): Cancel {
  if (!el || typeof window === "undefined") return () => {};
  if (typeof IntersectionObserver === "undefined") {
    task();
    return () => {};
  }
  const obs = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        obs.disconnect();
        task();
      }
    },
    { rootMargin: opts?.rootMargin ?? "300px" },
  );
  obs.observe(el);
  return () => obs.disconnect();
}
