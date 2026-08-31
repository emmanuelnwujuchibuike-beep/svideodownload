"use client";

import { useEffect, useState } from "react";

/**
 * True once the document has finished loading — the gate every ad unit waits
 * behind so none of them competes with the page's own first paint.
 *
 * ── Why this is now shared (owner, 2026-08-31: "frenzsave is stuck loading, it
 *    delays a lot, seems the lcp is broken") ─────────────────────────────────
 *
 * `ExoClickUnit` has waited for `load` since 2026-08-30, when ad creatives were
 * measured costing ~340ms of the landing page's LCP. `ExoClickSticky` never
 * did: it appended ExoClick's `ad-provider.js` — a ~195 KB script that then
 * parses and executes on the main thread — as soon as it mounted, which is
 * during hydration, which is while the browser is still fetching the thing the
 * LCP is waiting on.
 *
 * Measured on this build, Pixel 7, slow-4G + 4× CPU, median of 5:
 *
 *     third parties allowed   LCP 2940ms   21 long tasks (6221ms)
 *     third parties blocked   LCP  396ms    4 long tasks  (925ms)
 *
 * That is not a rounding error, and the banner is on every page now that the
 * bar is mounted from the root layout — so the one placement that skipped this
 * gate was the one running everywhere.
 *
 * Waiting costs the ads nothing that matters. Nobody sees a docked banner or
 * scrolls to an outstream slot inside the first second of a cold visit; the
 * unit still requests well before it is looked at, it just stops doing it in
 * front of the page.
 *
 * The 4-second cap is a safety net, not a target: if `load` has not fired by
 * then the page has something else wrong with it and LCP has long since
 * happened. Without the cap a single hanging subresource would mean no ad on
 * the page ever resolves, which is a worse failure than a late one.
 *
 * Units mounted after a client-side navigation see `readyState === "complete"`
 * immediately and are unaffected.
 */
export function usePageSettled(): boolean {
  const [settled, setSettled] = useState(
    () => typeof document !== "undefined" && document.readyState === "complete",
  );
  useEffect(() => {
    if (settled) return;
    const done = () => setSettled(true);
    window.addEventListener("load", done, { once: true });
    const cap = setTimeout(done, 4000);
    return () => {
      window.removeEventListener("load", done);
      clearTimeout(cap);
    };
  }, [settled]);
  return settled;
}
