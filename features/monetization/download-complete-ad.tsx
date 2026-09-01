"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { MONETAG_MOMENT_EVENTS } from "@/lib/monetization/monetag-events";

import { AdSlot } from "./ad-slot";
import { useAdGateCountdown } from "./use-ad-gate-countdown";
import { useShowAds } from "./use-show-ads";

/**
 * The panel shown once a download has actually completed.
 *
 * ── Why this moment and not earlier ───────────────────────────────────────────
 *
 * The visitor has what they came for. This is the one point in the flow where a
 * full-attention unit costs them nothing they were still waiting on — which is
 * exactly what makes it the right place for the most valuable placement and the
 * wrong place for a hostile one. It is skippable by default.
 *
 * ── The skip control is timed by the ad row, not hardcoded ────────────────────
 *
 * `skippable` and `skip_after_seconds` come from the placement, so an operator
 * decides in the admin whether this waits three seconds or none. A hardcoded
 * countdown would mean a redeploy to change a number that is a commercial
 * decision.
 *
 * 🔴 …and the NETWORK'S timer outranks the operator's (owner, 2026-08-30:
 * "admin timer set up should only be a fallback"). This ran its own hand-rolled
 * `setTimeout` chain off `skip_after_seconds` alone — the exact pattern
 * `useAdGateCountdown` was written to delete — so it was the last gated overlay
 * in the product still ignoring the length of the ad it was gating. It now uses
 * the same shared hook as the idle interstitial and the wallpaper reward gate,
 * which closes on the creative's own `ended`, targets its real duration when
 * that is shorter, and falls back to the admin number only when the creative has
 * no timeline to report.
 *
 * ── The countdown starts when the panel is SHOWN, and so does the scroll lock ──
 *
 * 🔴 THE BUG THIS FIXES (owner, 2026-08-31: "exoclick download complete doesnt
 * show timer, it just show blank and show the exist after it finished counting
 * hiddenly").
 *
 * The panel was `hidden` until `hasAd === true` — but the effect that locks
 * `document.body` to `overflow: hidden` was keyed on `open`, not on that. So the
 * instant a download finished, the page was scroll-locked underneath an overlay
 * that was `display: none`, and if the zone never filled it STAYED that way:
 * no ad, no panel, no countdown (that was keyed on `hasAd` too, so it never
 * started), no Skip control, no Escape — the page simply stopped scrolling with
 * nothing on screen to explain why, until a reload.
 *
 * Everything is now keyed on `shown` — the panel being genuinely visible — which
 * is the same shape `download-interstitial.tsx` already uses. Nothing is locked
 * behind an invisible overlay, and a zone that does not fill closes the panel
 * instead of leaving it open forever (see `onResolved`).
 *
 * NOTE, because it was checked and is worth not re-checking: the panel is NOT
 * clipped. `fixed inset-0` without a portal is the recorded failure mode here,
 * so every ancestor chain on `/`, `/downloads` and `/history` was measured for a
 * transform / filter / backdrop-filter / contain / will-change containing block.
 * There are none. The blank panel was this state bug, not a containing block.
 *
 * ── Half screen on desktop, sheet on mobile ───────────────────────────────────
 *
 * Centred and bounded on a large viewport rather than truly full screen — a unit
 * stretched across a 27" display looks like a takeover, not a placement. On
 * mobile it is a bottom sheet, which is the platform-native shape for something
 * that appears after an action completes.
 */
/**
 * How long this panel may hold the screen before it becomes closable no matter
 * what else has gone wrong. Longer than any skip delay an operator can set
 * (the admin caps `download_complete` well below this), so it never front-runs
 * the real countdown — it only catches the cases where the real countdown never
 * arrives.
 */
const HARD_ESCAPE_MS = 20_000;

export function DownloadCompleteAd({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { showAds, ready } = useShowAds();
  const [hasAd, setHasAd] = useState<boolean | null>(null);
  const [config, setConfig] = useState<{ skippable: boolean; skipAfter: number } | null>(null);
  /** Reset per opening, so a second download does not inherit the first's answer. */
  const wasOpen = useRef(open);

  const close = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (open === wasOpen.current) return;
    wasOpen.current = open;
    if (!open) setHasAd(null);
  }, [open]);

  /*
    🔴 ONE AD PER COMPLETED DOWNLOAD (owner, 2026-09-01: "the white ad, itsnt
    suppose to be the download complte because another 15second download complte
    video still plays").

    TWO placements answer the same `DOWNLOAD_COMPLETED_EVENT` and neither knew
    about the other: this panel, and the VAST skippable video
    (`vast-interstitial/download-complete-trigger.tsx`, owner 2026-08-30:
    "download completed ... should trigger a 5 to 15 sec skipable video ad").
    `requestVastInterstitial` guards against ITSELF — a busy phase and a
    cooldown — so a batch of twelve files still shows one video. It has never
    guarded against this panel, so one finished download produced a sponsored
    sheet AND a fifteen-second video, back to back.

    The video is the placement the owner specified for this moment, so this panel
    STANDS DOWN whenever that video is armed. Not "both, ordered nicely": two
    full-screen ads for one download is the complaint, and sequencing them is
    still two.

    Fails OPEN, deliberately: if the config cannot be read, this panel behaves as
    it always did. A missed ad is a rounding error; a download that silently
    shows nothing because a fetch failed is a revenue bug.
  */
  const [videoOwnsMoment, setVideoOwnsMoment] = useState(false);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetch("/api/ads/config")
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: { vastInterstitial?: { enabled?: boolean; enabledOnDownloadComplete?: boolean } }) => {
        if (!alive) return;
        const v = d.vastInterstitial;
        setVideoOwnsMoment(v?.enabled === true && v?.enabledOnDownloadComplete === true);
      })
      .catch(() => {
        /* Fails open — see above. */
      });
    return () => {
      alive = false;
    };
  }, [open]);

  /*
    Read the placement's own skip settings. Separate from AdSlot's fetch because
    AdSlot deliberately owns only rendering — but it is the same cached endpoint,
    so this costs no extra round trip in practice.
  */
  useEffect(() => {
    if (!open || config) return;
    let alive = true;
    fetch("/api/ads?zone=download_complete")
      .then((r) => (r.ok ? r.json() : { ad: null }))
      .then((d) => {
        if (!alive) return;
        setConfig({
          skippable: d.ad?.skippable ?? true,
          skipAfter: d.ad?.skipAfterSeconds ?? 5,
        });
      })
      .catch(() => alive && setConfig({ skippable: true, skipAfter: 0 }));
    return () => {
      alive = false;
    };
  }, [open, config]);

  // Signal the "after a download completes" moment so a Monetag placement can
  // load then (no-op unless the owner configured that placement + the visitor
  // should see ads — MonetagPlacements gates both).
  useEffect(() => {
    if (open && showAds) window.dispatchEvent(new Event(MONETAG_MOMENT_EVENTS.download_complete));
  }, [open, showAds]);

  /**
   * Genuinely on screen: open, and with a creative to frame.
   *
   * Every timed and locking behaviour below keys on THIS rather than on `open`.
   * A panel nobody can see must not hold the scroll, run a countdown, or swallow
   * Escape — all three of which it used to do.
   */
  const shown = open && hasAd === true;

  const { remaining, canSkip: countdownDone, onAdTiming } = useAdGateCountdown({
    fallbackSeconds: config?.skipAfter ?? 5,
    running: shown,
  });

  /*
    `skippable: false` is an operator saying "this one is watched through". The
    countdown still governs WHEN, and the hook opens the gate the moment the
    creative reports `ended`, so a non-skippable row is bounded by the ad's own
    length rather than by nothing.

    Computed above the effects, not below the early return: the Escape handler
    closes over it, and a `const` initialised later in the same render would be
    in its temporal dead zone for any render that returned early.
  */
  /*
    🔴 THE ESCAPE HATCH — A CEILING THAT DEPENDS ON NOTHING (owner, 2026-09-01:
    "the download complete card is not showing an X button again, users get
    stock").

    Every other route out of this panel is conditional on something reporting
    correctly: `countdownDone` needs `shown`, `shown` needs `AdSlot` to call
    `onResolved(true)`, and the button that carries it needs the sticky header
    to survive a creative taller than the sheet. Each of those has failed at
    least once, and every one of them fails the SAME way — a full-screen overlay
    with `body` locked and no way out but a reload.

    So this timer keys on `open` alone. Not `shown`, not the ad, not the
    countdown, not the config: if this panel has been mounted for
    HARD_ESCAPE_MS, it becomes closable, whatever else is or is not working.
    `skippable: false` does not suppress it either — an operator saying "watch
    this through" is not an operator asking to trap someone forever.

    It is deliberately longer than any configured skip delay, so in normal
    operation the real countdown always opens the gate first and this is never
    the thing the visitor waits for.
  */
  const [hardEscape, setHardEscape] = useState(false);
  useEffect(() => {
    if (!open) {
      setHardEscape(false);
      return;
    }
    const id = setTimeout(() => setHardEscape(true), HARD_ESCAPE_MS);
    return () => clearTimeout(id);
  }, [open]);

  /*
    Hand the parent's `completeAdOpen` back when the video takes the moment.
    In an effect, not in render: `close()` is the PARENT's setState, and calling
    it while this component renders is the "cannot update a component while
    rendering a different component" bug. Releasing it also means the NEXT
    completed download finds the panel closed and gets a fresh attempt, rather
    than one that believes it is already open.
  */
  useEffect(() => {
    if (open && videoOwnsMoment) close();
  }, [open, videoOwnsMoment, close]);

  const canSkip = (config?.skippable !== false && countdownDone) || hardEscape;
  const counting = !canSkip && remaining > 0;

  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && canSkip) close();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [shown, canSkip, close]);

  if (!ready || !showAds || !open || videoOwnsMoment) return null;

  return (
    <div
      className={cn(
        "fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4",
        !shown && "hidden",
      )}
      role="dialog"
      aria-modal="true"
      aria-label="Advertisement"
    >
      {/*
        The backdrop is a SECOND way out, available the moment the gate opens.
        The header control can be scrolled away or squashed by a creative taller
        than the sheet — both have happened — but the backdrop is a sibling of
        the sheet, so no amount of creative height can reach it.
      */}
      <div
        aria-hidden
        onClick={canSkip ? close : undefined}
        className={cn(
          "absolute inset-0 bg-background/80 backdrop-blur-sm",
          canSkip && "cursor-pointer",
        )}
      />

      {/*
        🔴 BOUNDED HEIGHT, AND THE HEADER PINNED (owner, 2026-08-30: "the after
        download completes is not showing properly, is being covered by the top
        header", with a screenshot of the Skip control cut in half by the
        Dynamic Island).

        This is a bottom sheet (`items-end`) with NO height cap. A 9:16 ExoClick
        creative is taller than the viewport, so the sheet grew past the top of
        the screen and its header — the line explaining what happened AND THE
        ONLY SKIP CONTROL — was pushed off it, underneath the status bar.

        That is not a cosmetic bug: with Skip off-screen and `body` locked to
        `overflow:hidden` by the effect above, the visitor is sealed inside an
        ad with no way out but a reload.

        🔴 THE FIRST ATTEMPT AT THIS FIX MADE IT WORSE, and how is worth
        recording: the header was a flex child of a `flex-col overflow-hidden`
        box with no `shrink-0`. A flex item's default `flex-shrink: 1` let the
        tall creative SQUASH the header to nothing, and `overflow-hidden`
        clipped what was left — so the title and the Skip button vanished
        entirely and the visitor was sealed in the ad again, worse than before.

        So this is deliberately NOT a flex column any more. The SHEET ITSELF is
        the scroll container and the header is `sticky top-0` inside it. Sticky
        needs a scrolling ancestor to stick to; making the sheet that ancestor
        is what makes the pin real rather than decorative, and there is no flex
        sizing left to get wrong.

          • `max-h` against `100dvh` — dvh, not vh, because mobile browser
            chrome makes vh taller than the visible viewport, which is the same
            class of mistake that caused the original bug.
          • the safe-area inset, so the top clears the notch / Dynamic Island.
          • the header's own `bg-card` is required: a transparent sticky header
            would have the creative scrolling visibly through it.
      */}
      <div
        className="relative w-full max-h-[calc(100dvh-var(--frenz-safe-top,0px)-1rem)] overflow-y-auto overscroll-contain rounded-t-3xl border border-border/60 bg-card px-4 pb-4 shadow-card sm:max-h-[calc(100dvh-2rem)] sm:max-w-lg sm:rounded-3xl"
        style={{ marginTop: "var(--frenz-safe-top, 0px)" }}
      >
        <div className="sticky top-0 z-10 -mx-4 flex items-center justify-between gap-3 border-b border-border/50 bg-card px-4 pb-3 pt-4">
          <div>
            {/*
              🔴 "COMPLETED", not "started" (owner, 2026-08-30).

              This panel is mounted by the download manager's COMPLETION path —
              the file is already on the device by the time it renders. The old
              copy described the wrong moment, and told someone their download
              had begun at the exact instant it had finished.
            */}
            <p className="text-sm font-semibold">Your download has completed</p>
            <p className="text-xs text-muted-foreground">Saved — check your downloads folder.</p>
          </div>

          {/*
            One control that changes state rather than two that swap places —
            a button that appears where a countdown was is a target that moves
            under the cursor at the exact moment it becomes pressable.

            🔴 THE COUNTING STATE IS LEGIBLE (owner, 2026-08-31: "doesnt show
            timer … show the exist after it finished counting hiddenly").

            It was `text-muted-foreground` on `bg-card` — a muted 12px label on a
            card, which is the styling this design system uses for text that is
            deliberately recessive. So the one element telling the visitor how
            long they are being held read as disabled chrome, and the control
            only looked like it had appeared when it flipped to the enabled
            state. The waiting state now carries a tabular number at full
            foreground contrast; only the word around it stays muted.
          */}
          <button
            type="button"
            onClick={close}
            disabled={!canSkip}
            aria-label={canSkip ? "Close advertisement" : `Skip available in ${remaining} seconds`}
            aria-live={counting ? "off" : "polite"}
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition",
              canSkip
                ? "border-border text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                : "cursor-default border-border/70 bg-secondary/40 text-muted-foreground",
            )}
          >
            {counting ? (
              <>
                <span>Skip in</span>
                <span className="tabular-nums text-sm font-semibold text-foreground">{remaining}</span>
              </>
            ) : (
              "Skip"
            )}
            {canSkip ? <X className="h-3.5 w-3.5" /> : null}
          </button>
        </div>

        {/* Plain flow inside the scroller — no flex, so nothing can be squashed.
            The bottom inset keeps the last of the creative clear of the home
            indicator on a gesture-nav phone. */}
        <div style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
          <p className="mb-2 mt-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
            Sponsored
          </p>
          <AdSlot
            zone="download_complete"
            dismissible={false}
            onAdTiming={onAdTiming}
            /*
              🔴 A NO-FILL CLOSES THE PANEL, it does not leave it open.

              `onResolved(false)` means this zone has nothing to show. Holding
              `open` in that case is what produced an invisible modal that
              outlived the download — and, before the lock was moved onto
              `shown`, took the page's scrolling with it. Closing also resets the
              parent's `completeAdOpen`, so the NEXT completed download gets a
              fresh attempt rather than finding the panel already "open".
            */
            onResolved={(filled) => {
              setHasAd(filled);
              if (!filled) close();
            }}
          />
        </div>
      </div>
    </div>
  );
}
