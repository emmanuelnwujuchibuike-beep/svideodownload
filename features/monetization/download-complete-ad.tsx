"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

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

      <div className="relative w-full rounded-t-3xl border border-border/60 bg-card p-4 shadow-card sm:max-w-lg sm:rounded-3xl">
        <div className="mb-3 flex items-center justify-between gap-3">
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

        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
          Sponsored
        </p>
        <AdSlot zone="download_complete" dismissible={false} onResolved={setHasAd} />
      </div>
    </div>
  );
}
