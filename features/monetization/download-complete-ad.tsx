"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { MONETAG_MOMENT_EVENTS } from "@/lib/monetization/monetag-events";

import { AdSlot } from "./ad-slot";
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
 * The countdown starts when the AD RESOLVES, not when the component mounts. On a
 * slow connection those differ by seconds, and starting at mount lets the skip
 * button appear before the ad it is meant to skip.
 *
 * ── Half screen on desktop, sheet on mobile ───────────────────────────────────
 *
 * Centred and bounded on a large viewport rather than truly full screen — a unit
 * stretched across a 27" display looks like a takeover, not a placement. On
 * mobile it is a bottom sheet, which is the platform-native shape for something
 * that appears after an action completes.
 */
export function DownloadCompleteAd({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { showAds, ready } = useShowAds();
  const [hasAd, setHasAd] = useState<boolean | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [config, setConfig] = useState<{ skippable: boolean; skipAfter: number } | null>(null);
  const started = useRef(false);

  const close = useCallback(() => {
    started.current = false;
    setRemaining(null);
    onClose();
  }, [onClose]);

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

  // Countdown begins only once there is genuinely an ad on screen.
  useEffect(() => {
    if (!open || hasAd !== true || !config || started.current) return;
    started.current = true;
    if (!config.skippable) return;
    setRemaining(config.skipAfter);
  }, [open, hasAd, config]);

  useEffect(() => {
    if (remaining === null || remaining <= 0) return;
    const t = setTimeout(() => setRemaining((r) => (r === null ? null : r - 1)), 1000);
    return () => clearTimeout(t);
  }, [remaining]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && remaining !== null && remaining <= 0) close();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, remaining, close]);

  if (!ready || !showAds || !open) return null;

  const canSkip = config?.skippable !== false && remaining !== null && remaining <= 0;
  const counting = remaining !== null && remaining > 0;

  return (
    <div
      className={cn(
        "fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4",
        hasAd !== true && "hidden",
      )}
      role="dialog"
      aria-modal="true"
      aria-label="Advertisement"
    >
      <div aria-hidden className="absolute inset-0 bg-background/80 backdrop-blur-sm" />

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

        Three parts to the fix, all load-bearing:
          • `max-h` against `100dvh` — dvh, not vh, because mobile browser
            chrome makes vh taller than the visible viewport, which is the same
            class of mistake that caused this.
          • the safe-area inset, so the top clears the notch / Dynamic Island
            rather than merely clearing the viewport edge.
          • `overflow-y-auto` on the body with the header `sticky`, so a tall
            creative scrolls UNDER a Skip button that is always on screen.
      */}
      <div
        className="relative flex w-full max-h-[calc(100dvh-var(--frenz-safe-top,0px)-1rem)] flex-col overflow-hidden rounded-t-3xl border border-border/60 bg-card shadow-card sm:max-h-[calc(100dvh-2rem)] sm:max-w-lg sm:rounded-3xl"
        style={{ marginTop: "var(--frenz-safe-top, 0px)" }}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border/50 bg-card px-4 pb-3 pt-4">
          <div>
            <p className="text-sm font-semibold">Your download has started</p>
            <p className="text-xs text-muted-foreground">Check your downloads folder.</p>
          </div>

          {/*
            One control that changes state rather than two that swap places —
            a button that appears where a countdown was is a target that moves
            under the cursor at the exact moment it becomes pressable.
          */}
          <button
            type="button"
            onClick={close}
            disabled={!canSkip}
            aria-label={canSkip ? "Close advertisement" : `Skip available in ${remaining} seconds`}
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-border px-3 text-xs font-medium transition",
              canSkip
                ? "text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                : "cursor-default text-muted-foreground",
            )}
          >
            {counting ? `Skip in ${remaining}` : "Skip"}
            {canSkip ? <X className="h-3.5 w-3.5" /> : null}
          </button>
        </div>

        {/*
          The scrolling body. `min-h-0` is what actually makes it scroll: a flex
          child's default `min-height:auto` refuses to shrink below its content,
          so without it the creative would push the sheet past its own max-height
          again and re-create the bug this fix exists for.

          The bottom inset keeps the last of the creative clear of the home
          indicator on a gesture-nav phone.
        */}
        <div
          className="min-h-0 flex-1 overflow-y-auto px-4 pt-3"
          style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
        >
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
            Sponsored
          </p>
          <AdSlot zone="download_complete" dismissible={false} onResolved={setHasAd} />
        </div>
      </div>
    </div>
  );
}
