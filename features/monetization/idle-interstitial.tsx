"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { hilltopZoneSource, type HilltopConfig } from "@/lib/monetization/hilltop-config";

import { isPlayerOpen } from "@/features/downloads/player-store";

import { FullscreenInterstitial } from "./fullscreen-interstitial";
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
      // Never over a clip the visitor is watching in the review player (owner: the
      // interstitial "shouldn't [show] while video is playing"). The review player
      // can be open on marketing surfaces too (the landing download history).
      if (isPlayerOpen()) return false;
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

  /*
    🔴 STAND DOWN WHEN THE VIDEO OWNS THIS MOMENT (owner, 2026-09-01: "the idle
    interstilla shows more of banner and less of vast video").

    This component renders an ad ROW through AdSlot, which has no video branch,
    so it can only ever show a banner here. When the zone is set to `vast` the
    `ambient` trigger plays the real video instead, and two answers to one moment
    is what produced "mostly banner, sometimes video".

    Fails to the BANNER on a config error rather than to nothing: a missed video
    is a rounding error, a silently dead idle placement is not.
  */
  const [videoOwnsMoment, setVideoOwnsMoment] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/ads/config")
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: { hilltop?: HilltopConfig }) => {
        if (alive && d.hilltop) {
          setVideoOwnsMoment(hilltopZoneSource(d.hilltop, "idle_interstitial") === "vast");
        }
      })
      .catch(() => {
        /* The banner is the safe outcome. */
      });
    return () => {
      alive = false;
    };
  }, []);

  // Nothing for premium visitors, and nothing until the plan is known.
  if (!ready || !showAds || videoOwnsMoment) return null;

  /*
    Always rendered so the ad PRELOADS, but only interactive once open AND
    filled. While hidden it is `display:none` — a srcDoc iframe still fetches
    and paints there, so by the time the overlay reveals the creative is ready.

    `pointer-events-none` while hidden guarantees the invisible overlay can
    never intercept a click on the page behind it.
  */
  return (
    <FullscreenInterstitial
      zone="idle_interstitial"
      shown={shown}
      onClose={close}
      onResolved={setHasAd}
    />
  );
}
