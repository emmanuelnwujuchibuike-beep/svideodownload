"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { AdSlot } from "./ad-slot";
import { useShowAds } from "./use-show-ads";

/**
 * A unit shown when the visitor looks like they are leaving.
 *
 * ── Why this was declared for months and never built ──────────────────────────
 *
 * `exit_intent_popup` existed in the zone list with no component rendering it,
 * so a row seeded there was silently never shown. That is the worst state for a
 * placement to be in — configurable, apparently live, and dead. This is the
 * component that makes the zone real.
 *
 * ── Desktop and mobile need completely different signals ──────────────────────
 *
 * On desktop, "exit intent" is a solved problem: the pointer leaves the top edge
 * of the viewport on its way to the address bar or the tab strip. `mouseout`
 * with `relatedTarget === null` and `clientY <= 0` is that, precisely.
 *
 * On touch there is no pointer and therefore no such signal. The technique the
 * ad industry uses instead is a `history.pushState` trap that swallows the
 * BACK BUTTON — deliberately breaking navigation to show an ad. That is not
 * shipped here. Breaking the back button is the single most hostile thing a
 * page can do, this product is positioned on trust, and it is the same class of
 * hijack as the pop-unders that were removed.
 *
 * So mobile uses an honest proxy: the page being hidden (tab switched, app
 * backgrounded) is a real signal the visit is ending, and it costs the visitor
 * nothing. Fewer impressions than a back-button trap. That is the trade.
 *
 * ── Everything else matches the idle interstitial ─────────────────────────────
 *
 * Once per session, never in the first few seconds, always closable from the top
 * right, and gated server-side by the `interstitial` switch — which is off by
 * default, so this cannot appear on a site that has not deliberately enabled it.
 */

/** Never before this long into a visit — a pointer leaving immediately is noise. */
const MIN_GAP_MS = 5_000;

const SESSION_KEY = "frenz:exit-intent-shown";

export function ExitIntent() {
  const { showAds, ready } = useShowAds();
  const [open, setOpen] = useState(false);
  const [hasAd, setHasAd] = useState<boolean | null>(null);
  const mountedAt = useRef(Date.now());
  const spent = useRef(false);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!ready || !showAds) return;

    try {
      if (sessionStorage.getItem(SESSION_KEY)) return;
    } catch {
      // Storage blocked. Treat as already shown: failing closed costs one
      // impression, failing open removes the cap entirely for those visitors.
      return;
    }

    const trigger = () => {
      if (spent.current) return;
      if (Date.now() - mountedAt.current < MIN_GAP_MS) return;
      spent.current = true;
      try {
        sessionStorage.setItem(SESSION_KEY, "1");
      } catch {
        /* capped for this mount regardless, via `spent` */
      }
      setOpen(true);
    };

    /*
      Desktop: the pointer crossing the TOP edge on its way out of the document.
      `relatedTarget === null` means it left the window rather than moving to
      another element, and `clientY <= 0` distinguishes the address bar from a
      drift out of the left, right or bottom edge — which are not exits.
    */
    const onMouseOut = (e: MouseEvent) => {
      if (e.relatedTarget === null && e.clientY <= 0) trigger();
    };

    /*
      Touch: the page becoming hidden. A real end-of-visit signal that costs the
      visitor nothing — deliberately NOT a back-button trap.
    */
    const onVisibility = () => {
      if (document.visibilityState === "hidden") trigger();
    };

    document.addEventListener("mouseout", onMouseOut);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("mouseout", onMouseOut);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ready, showAds]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, close]);

  if (!ready || !showAds || !open) return null;

  /*
    Painted only once the slot confirms a creative. An unseeded zone would
    otherwise black out the page around nothing — the empty-box bug at
    full-screen scale, on the way out of the site.
  */
  return (
    <div
      className={hasAd === true ? "fixed inset-0 z-[60] flex items-center justify-center p-4" : "hidden"}
      role="dialog"
      aria-modal="true"
      aria-label="Advertisement"
    >
      <button
        type="button"
        aria-label="Close advertisement"
        onClick={close}
        className="absolute inset-0 h-full w-full cursor-default bg-background/80 backdrop-blur-sm"
      />

      <div className="relative w-full max-w-lg rounded-3xl border border-border/60 bg-card p-4 shadow-card">
        <button
          type="button"
          onClick={close}
          aria-label="Close advertisement"
          className="absolute -right-3 -top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-card transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <X className="h-4 w-4" />
        </button>

        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
          Sponsored
        </p>
        <AdSlot zone="exit_intent_popup" dismissible={false} onResolved={setHasAd} />
      </div>
    </div>
  );
}
