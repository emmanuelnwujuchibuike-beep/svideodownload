"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { AdSlot } from "./ad-slot";
import { useShowAds } from "./use-show-ads";

/**
 * A full-screen unit shown after the visitor has gone idle.
 *
 * ── It PRELOADS, so it appears instantly ──────────────────────────────────────
 *
 * The reported "takes time to show" was structural: the ad slot used to mount
 * only when the interstitial opened, so the creative did not begin loading
 * until the moment it was meant to be on screen — the visitor then watched an
 * empty card fill in. The slot is now mounted from the start, hidden, so it
 * fetches and paints in the background while the idle timer runs. When the timer
 * fires the ad is already there and the overlay reveals with no wait.
 *
 * ── Frequency capping is not optional here ────────────────────────────────────
 *
 * Three seconds of no input is not an unusual state — it is what reading looks
 * like. So the repeat is capped: once per session, and never within
 * `MIN_GAP_MS` of load. That is what keeps it survivable, and what keeps it
 * inside Google's interstitial policy — a unit that reappears every few seconds
 * is what gets a publisher account suspended.
 *
 * ── Off unless explicitly enabled ─────────────────────────────────────────────
 *
 * The `interstitial` switch defaults OFF and gates the zone server-side, so a
 * site that never configures anything never shows one.
 *
 * ── The X is present the instant the ad is ────────────────────────────────────
 *
 * It is a solid, high-contrast button at the top-right of the ad, visible from
 * the first frame the overlay is shown — no countdown, because the visitor did
 * not ask for this. Escape and a tap on the backdrop also close it.
 */

/** Idle time before the unit is offered. */
const IDLE_MS = 3_000;

/**
 * Never within this long of load, however still the visitor is.
 *
 * Matched to the idle threshold, so in practice the unit shows about three
 * seconds into a still page. Not zero, because that lets the interstitial race
 * the page's own first paint — meeting an ad before the content has rendered
 * reads as a broken page rather than an ad.
 */
const MIN_GAP_MS = 3_000;

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
      // shown": failing closed costs one impression, failing open removes the
      // cap entirely for those visitors.
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

    // `passive` on every listener — these fire on scroll and pointermove, and
    // none of them calls preventDefault.
    for (const event of ACTIVITY) {
      window.addEventListener(event, arm, { passive: true });
    }
    arm();

    return () => {
      window.clearTimeout(timer);
      for (const event of ACTIVITY) window.removeEventListener(event, arm);
    };
  }, [ready, showAds]);

  const shown = open && hasAd === true;

  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    // The page behind must not scroll while the panel is up.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [shown, close]);

  // Nothing for premium visitors, and nothing until the plan is known.
  if (!ready || !showAds) return null;

  /*
    Always rendered so the ad PRELOADS, but only interactive once open AND
    filled. While hidden it is `display:none` — a srcDoc iframe still fetches
    and paints there, so by the time the overlay reveals the creative is ready.

    `pointer-events-none` while hidden guarantees the invisible overlay can
    never intercept a click on the page behind it.
  */
  return (
    <div
      className={cn(
        "fixed inset-0 z-[60] flex items-center justify-center p-4",
        shown ? "opacity-100" : "pointer-events-none opacity-0",
      )}
      // `hidden` for assistive tech and to stop the backdrop showing, without
      // unmounting the slot that is preloading inside.
      aria-hidden={!shown}
      role="dialog"
      aria-modal={shown}
      aria-label="Advertisement"
    >
      <button
        type="button"
        aria-label="Close advertisement"
        tabIndex={shown ? 0 : -1}
        onClick={close}
        className={cn(
          "absolute inset-0 h-full w-full cursor-default bg-background/80 backdrop-blur-sm",
          !shown && "hidden",
        )}
      />

      <div
        className={cn(
          "relative w-full max-w-lg rounded-3xl border border-border/60 bg-card p-4 shadow-card",
          !shown && "hidden",
        )}
      >
        {/*
          The dismiss control. Solid primary fill, at the ad's top-right corner,
          present from the first frame the overlay is shown — the "X should show
          when the ad shows" ask. Large enough to be an easy tap target (44px),
          and lifted slightly outside the card so it never sits over the unit.
        */}
        <button
          type="button"
          onClick={close}
          tabIndex={shown ? 0 : -1}
          aria-label="Close advertisement"
          className="absolute -right-3 -top-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-foreground text-background shadow-elevated ring-2 ring-background transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <X className="h-5 w-5" strokeWidth={2.5} />
        </button>

        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
          Sponsored
        </p>
        <AdSlot zone="idle_interstitial" dismissible={false} onResolved={setHasAd} />
      </div>
    </div>
  );
}
