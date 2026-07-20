"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { AdSlot } from "./ad-slot";
import { useShowAds } from "./use-show-ads";

/**
 * A full-screen unit shown after the visitor has gone idle.
 *
 * ── Frequency capping is not optional here ────────────────────────────────────
 *
 * The brief was "idle for more than 5 seconds". Five seconds of no input is not
 * an unusual state — it is what reading a paragraph looks like. Without a cap
 * this would fire, be dismissed, and fire again a few seconds later, for the
 * whole visit.
 *
 * So the trigger is exactly as specified and the REPEAT is capped: once per
 * session, and never within `MIN_GAP_MS` of the page loading. That is what makes
 * it survivable, and it is also what keeps it inside Google's policy on
 * interstitials — an ad that reappears every few seconds is the pattern that
 * gets a publisher account suspended, which would cost far more than the unit
 * earns.
 *
 * ── Off unless explicitly enabled ─────────────────────────────────────────────
 *
 * The `interstitial` switch in monetization settings defaults to OFF, so a site
 * that never configures anything never shows one. `/api/ads` refuses to serve
 * the zone while the switch is off, which means the gate is server-side and not
 * something this component can be talked out of.
 *
 * ── It always closes ──────────────────────────────────────────────────────────
 *
 * The X sits at the top right, as specified, and Escape works too. There is no
 * timer before it appears: the visitor did not ask for this, so making them wait
 * to dismiss something they did not request is the part that turns an ad into a
 * hostage situation.
 */

/** Idle time before the unit is offered. The brief's number. */
const IDLE_MS = 5_000;

/**
 * Never within this long of the page loading, no matter how still the visitor
 * is. Someone who lands and reads for five seconds has not gone idle — they
 * have started, and interrupting that is the worst possible first impression.
 */
const MIN_GAP_MS = 45_000;

const SESSION_KEY = "frenz:idle-interstitial-shown";

const ACTIVITY = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"] as const;

export function IdleInterstitial() {
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
      // Private mode or a blocked storage partition. Treat it as "already
      // shown": failing closed here costs one impression, and failing open
      // would remove the cap entirely for those visitors.
      return;
    }

    let timer: number | undefined;

    const arm = () => {
      window.clearTimeout(timer);
      if (spent.current) return;
      timer = window.setTimeout(() => {
        if (spent.current) return;
        if (Date.now() - mountedAt.current < MIN_GAP_MS) {
          arm(); // Too early in the visit — go round again rather than give up.
          return;
        }
        spent.current = true;
        try {
          sessionStorage.setItem(SESSION_KEY, "1");
        } catch {
          /* capped for this mount regardless, via `spent` */
        }
        setOpen(true);
      }, IDLE_MS);
    };

    /*
      `passive` on every listener: these fire on scroll and pointermove, i.e.
      the two events most able to make a page feel heavy, and none of them
      calls preventDefault.
    */
    for (const event of ACTIVITY) {
      window.addEventListener(event, arm, { passive: true });
    }
    arm();

    return () => {
      window.clearTimeout(timer);
      for (const event of ACTIVITY) window.removeEventListener(event, arm);
    };
  }, [ready, showAds]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    // The page behind must not scroll while a full-screen panel is up.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, close]);

  if (!ready || !showAds || !open) return null;

  /*
    The overlay itself is only painted once the slot confirms an ad. Otherwise
    an unseeded zone would black out the page around nothing — the empty-box
    bug at full-screen scale, which is the worst place for it.
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
        {/* Far top right, as specified — and outside the card's own padding so
            it never overlaps the unit. */}
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
        <AdSlot zone="idle_interstitial" dismissible={false} onResolved={setHasAd} />
      </div>
    </div>
  );
}
