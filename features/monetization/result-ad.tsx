"use client";

import { SkipForward } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { AdSlotData } from "@/lib/monetization/types";
import { cn } from "@/lib/utils";

import { AdSlot } from "./ad-slot";

/**
 * The download-result placement, with a skip control.
 *
 * ── Why this is not just an `AdSlot` ──────────────────────────────────────────
 *
 * The result placement can hold a video, and a video the visitor cannot skip on
 * the screen where their file is waiting is the single most resented pattern in
 * this product category. So the unit is wrapped in a control the operator
 * configures per placement (`skippable`, `skip_after_seconds`) rather than one
 * hardcoded here.
 *
 * ── The countdown starts when the ad is ON SCREEN ─────────────────────────────
 *
 * Not at mount. Those are seconds apart on a slow connection, and starting at
 * mount means the skip button can become available before the ad has painted —
 * the visitor skips something they never saw, the advertiser is billed for an
 * impression nobody had, and the placement earns its reputation for nothing.
 *
 * ── Video is a real `<video>`, not a script ───────────────────────────────────
 *
 * A `video`-format row stores a direct URL. `muted` and `playsInline` are load
 * bearing: without them iOS refuses to autoplay at all and the visitor sits in
 * front of a black rectangle waiting for a countdown driven by a video that
 * never started.
 */
export function ResultAd({ className }: { className?: string }) {
  const [ad, setAd] = useState<AdSlotData | null | undefined>(undefined);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [skipped, setSkipped] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/ads?zone=download_result_page")
      .then((r) => (r.ok ? r.json() : { ad: null }))
      .then((d) => alive && setAd(d.ad ?? null))
      .catch(() => alive && setAd(null));
    return () => {
      alive = false;
    };
  }, []);

  // Countdown begins once there is an ad to count against.
  useEffect(() => {
    if (!ad || started.current) return;
    started.current = true;
    if (ad.skippable === false) return;
    setRemaining(ad.skipAfterSeconds ?? 5);
  }, [ad]);

  useEffect(() => {
    if (remaining === null || remaining <= 0) return;
    const t = setTimeout(() => setRemaining((r) => (r === null ? null : r - 1)), 1000);
    return () => clearTimeout(t);
  }, [remaining]);

  if (!ad || skipped) return null;

  const isVideo = ad.format === "video" && Boolean(ad.scriptCode);
  const canSkip = ad.skippable !== false && remaining !== null && remaining <= 0;
  const counting = remaining !== null && remaining > 0;

  return (
    <div className={cn("mx-auto mt-6 w-full max-w-2xl", className)}>
      <div className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-soft">
        <div className="flex items-center justify-between gap-3 px-3 pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
            Sponsored
          </p>
          {ad.skippable !== false ? (
            <button
              type="button"
              onClick={() => setSkipped(true)}
              disabled={!canSkip}
              aria-label={canSkip ? "Skip ad" : `Skip available in ${remaining} seconds`}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-full border border-border px-2.5 text-[11px] font-medium transition",
                canSkip
                  ? "text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  : "cursor-default text-muted-foreground",
              )}
            >
              {counting ? `Skip in ${remaining}` : "Skip"}
              {canSkip ? <SkipForward className="h-3 w-3" /> : null}
            </button>
          ) : null}
        </div>

        <div className="p-3">
          {isVideo ? (
            <video
              src={ad.scriptCode!}
              poster={ad.imageUrl ?? undefined}
              autoPlay
              muted
              playsInline
              controls
              className="aspect-video w-full rounded-xl bg-black"
            />
          ) : (
            /*
              Everything else — AdSense, display, native — goes through the
              normal slot. It re-requests the zone, which the 30-second cache on
              /api/ads absorbs, and in exchange this component does not
              reimplement three renderers that already exist and are tested.
            */
            <AdSlot zone="download_result_page" dismissible={false} />
          )}
        </div>
      </div>
    </div>
  );
}
