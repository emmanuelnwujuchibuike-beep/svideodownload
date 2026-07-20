"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { AdSlot } from "./ad-slot";
import { useShowAds } from "./use-show-ads";

/**
 * A full-screen unit shown on re-engagement — either the visitor returning after
 * being away, or a stretch of in-page idle.
 *
 * ── Two triggers ──────────────────────────────────────────────────────────────
 *
 * 1. RETURN FROM AWAY (the owner's ask): the tab was hidden or the app
 *    backgrounded for at least five seconds and the visitor has come back. This
 *    is the better of the two — the visitor actively returned, so the ad meets
 *    attention at a natural break instead of interrupting.
 * 2. IN-PAGE IDLE: three seconds with no interaction while the tab is focused.
 *
 * Both share one cooldown (not a once-per-session cap), so a visitor who leaves
 * and returns several times sees the unit again — but never more than once per
 * minute, which is what keeps it clear of the "reappears constantly" pattern
 * that suspends AdSense accounts.
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

/** Idle time (no interaction, tab focused) before the unit is offered. */
const IDLE_MS = 3_000;

/**
 * How long the visitor must be AWAY — tab hidden, app backgrounded — for their
 * return to count as a re-engagement worth showing an ad on.
 *
 * This is the trigger the owner asked for: leave for five seconds, come back,
 * see the ad. It is a better moment than pure idle — the visitor has actively
 * returned, so the ad meets attention rather than interrupting reading — and it
 * is the pattern app interstitials are actually designed around.
 */
const AWAY_MS = 5_000;

/**
 * Minimum time between interstitials.
 *
 * Replaces the old once-per-session cap. Returning from away is a repeatable,
 * natural break, so capping it to a single lifetime impression wasted most of
 * them — but firing on every quick tab-flick is exactly the spam that gets an
 * AdSense account suspended. A cooldown threads that: re-engage on return, but
 * never more than once per window.
 */
const COOLDOWN_MS = 60_000;

/**
 * Never within this long of load, however still the visitor is.
 *
 * Matched to the idle threshold, so in practice the unit shows about three
 * seconds into a still page. Not zero, because that lets the interstitial race
 * the page's own first paint — meeting an ad before the content has rendered
 * reads as a broken page rather than an ad.
 */
const MIN_GAP_MS = 3_000;

const LAST_SHOWN_KEY = "frenz:interstitial-last-shown";

const ACTIVITY = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"] as const;

export function IdleInterstitial() {
  const { showAds, ready } = useShowAds();
  const [open, setOpen] = useState(false);
  const [hasAd, setHasAd] = useState<boolean | null>(null);
  const mountedAt = useRef(Date.now());
  /** When the visitor's tab last went hidden — for the return-from-away trigger. */
  const hiddenAt = useRef<number | null>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!ready || !showAds) return;

    /** Persisted across reloads and client navigations, so the cooldown holds. */
    const lastShown = (): number => {
      try {
        return Number(sessionStorage.getItem(LAST_SHOWN_KEY)) || 0;
      } catch {
        // Storage blocked: report "just shown" so the cooldown fails CLOSED
        // rather than removing the cap for that visitor.
        return Date.now();
      }
    };

    /** Whether an interstitial may be shown right now. */
    const canShow = () => {
      if (open) return false;
      if (Date.now() - mountedAt.current < MIN_GAP_MS) return false;
      return Date.now() - lastShown() >= COOLDOWN_MS;
    };

    const show = () => {
      if (!canShow()) return;
      try {
        sessionStorage.setItem(LAST_SHOWN_KEY, String(Date.now()));
      } catch {
        /* the in-memory `open` still prevents a double-fire this tick */
      }
      setOpen(true);
    };

    /* ── Trigger 1: idle in-page (no interaction, tab focused) ── */
    let timer: number | undefined;
    const arm = () => {
      window.clearTimeout(timer);
      // Only while the tab is actually visible — an idle timer must not run down
      // in a backgrounded tab and then fire the instant the visitor returns,
      // which is the return trigger's job and would double-count.
      if (document.visibilityState !== "visible") return;
      timer = window.setTimeout(show, IDLE_MS);
    };

    /* ── Trigger 2: return after being away ≥ AWAY_MS ── */
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt.current = Date.now();
        window.clearTimeout(timer);
        return;
      }
      // Back in view.
      const away = hiddenAt.current ? Date.now() - hiddenAt.current : 0;
      hiddenAt.current = null;
      if (away >= AWAY_MS) show();
      else arm(); // short flick away — just restart the idle timer
    };

    for (const event of ACTIVITY) {
      window.addEventListener(event, arm, { passive: true });
    }
    document.addEventListener("visibilitychange", onVisibility);
    arm();

    return () => {
      window.clearTimeout(timer);
      for (const event of ACTIVITY) window.removeEventListener(event, arm);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ready, showAds, open]);

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
