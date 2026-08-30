"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Download, Lock, Pause, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { MONETAG_MOMENT_EVENTS } from "@/lib/monetization/monetag-events";
import type { AdSlotData } from "@/lib/monetization/types";
import { cn } from "@/lib/utils";

import { AdSlot } from "./ad-slot";

import { Portal } from "@/components/ui/portal";

function beacon(kind: "impression" | "click", adId: string) {
  navigator.sendBeacon?.(
    "/api/track",
    new Blob([JSON.stringify({ kind, zone: "reward_video", adId })], { type: "application/json" }),
  );
}

/**
 * Rewarded-ad gate for high-quality downloads. Shows a 30s ad; the close (X)
 * and download appear ONLY once watched. For a video ad, time accrues only
 * while it's actually playing — pausing freezes progress (no reward until it's
 * watched ~20-30s). Dormant: if no `reward_video` ad is configured it grants the
 * reward immediately so downloads aren't blocked.
 */
export function RewardedAdGate({
  open,
  durationSec = 30,
  skipAfterSec = null,
  /** "1 of 2" — shown only when a second ad follows, so the wait is honest. */
  step,
  totalSteps,
  onReward,
  onCancel,
}: {
  open: boolean;
  durationSec?: number;
  /**
   * Seconds after which a Skip control appears; `null` means it must be watched
   * out (Feature: size-gated rewards, 2026-08-11).
   *
   * A 500 MB+ file earns two ads, but sixty uninterrupted seconds in front of a
   * download someone is already waiting for is how a downloader gets abandoned.
   * The SECOND ad is skippable at 15s: the impression is still served and
   * counted, and nobody who has already watched a full thirty seconds is
   * punished further for the size of a file they did not choose.
   */
  skipAfterSec?: number | null;
  step?: number;
  totalSteps?: number;
  onReward: () => void;
  onCancel: () => void;
}) {
  const [ad, setAd] = useState<AdSlotData | null | undefined>(undefined);
  /** null until the fallback slot answers; false means it has nothing to show. */
  const [slotHasAd, setSlotHasAd] = useState<boolean | null>(null);
  const [watched, setWatched] = useState(0);
  const [required, setRequired] = useState(durationSec);
  const [paused, setPaused] = useState(false);
  const [errored, setErrored] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastT = useRef(0);
  const granted = useRef(false);

  // Load the reward ad each time the gate opens.
  useEffect(() => {
    if (!open) return;
    setAd(undefined);
    setWatched(0);
    setRequired(durationSec);
    setPaused(false);
    setErrored(false);
    lastT.current = 0;
    granted.current = false;
    let alive = true;
    fetch("/api/ads?zone=reward_video")
      .then((r) => (r.ok ? r.json() : { ad: null }))
      .then((d) => alive && setAd(d.ad ?? null))
      .catch(() => alive && setAd(null));
    return () => {
      alive = false;
    };
  }, [open, durationSec]);

  // No reward ad configured → grant immediately (feature stays dormant).
  useEffect(() => {
    if (open && ad === null && !granted.current) {
      granted.current = true;
      onReward();
    }
  }, [open, ad, onReward]);

  const videoSrc = ad && ad.format === "video" ? ad.scriptCode : null;

  /*
    Beacon an impression ONLY for the video this component renders itself.

    ── The double count (owner audit, 2026-08-09) ────────────────────────────
    This fired for every ad, including the ones handed to the `<AdSlot
    zone="reward_video">` below — and AdSlot beacons its own impression for the
    same zone the moment its ad resolves. So every non-video reward ad was
    counted TWICE: once here, once there.

    That is not a rounding error. `reward_video` impressions were doubled, its
    CTR was halved (real clicks over inflated impressions), and because revenue
    is `impressions / 1000 × CPM`, the estimated income from this placement was
    exactly 2× the truth. Whichever component owns the rendering owns the count;
    for a network ad that is AdSlot, so this now stays out of its way.
  */
  useEffect(() => {
    if (ad?.id && ad.format === "video" && ad.scriptCode) beacon("impression", ad.id);
  }, [ad]);

  // Signal the "rewarded" moment so a Monetag placement can load then (no-op
  // unless the owner configured it + the visitor should see ads).
  useEffect(() => {
    if (open) window.dispatchEvent(new Event(MONETAG_MOMENT_EVENTS.rewarded));
  }, [open]);

  // Timer mode (non-video network ad, or video that errored): wall-clock.
  useEffect(() => {
    if (!open || !ad) return;
    if (videoSrc && !errored) return;
    const id = setInterval(() => setWatched((w) => Math.min(durationSec, w + 1)), 1000);
    return () => clearInterval(id);
  }, [open, ad, videoSrc, errored, durationSec]);

  if (!open || ad === undefined || ad === null) return null;

  const done = watched >= required - 0.4;
  const remaining = Math.max(0, Math.ceil(required - watched));
  const pct = Math.min(100, (watched / required) * 100);
  /*
    The Skip affordance, on the second ad only.
    Measured against the SAME `watched` clock the reward uses — which for a video
    ad advances only while it is actually playing. Using wall-clock here instead
    would let someone open the gate, pause, wait fifteen seconds and skip without
    the ad ever having played a frame.
  */
  /*
    🔴 THE SKIP THRESHOLD IS CAPPED BY THE AD'S REAL LENGTH (owner, 2026-08-30:
    "to be skipable when the ad finishes in the ad network, admin timer set up
    should only be a fallback").

    `required` was already capped this way by `onLoadedMeta`; `skipAfterSec` was
    not, and that asymmetry was a dead control. `watched` can never exceed
    `required`, so a 15-second skip threshold over a 12-second fill meant
    `watched >= 15` was UNREACHABLE — the Skip button counted down to "1" and
    stopped there forever, on a modal whose whole purpose is that skipping is
    allowed. Capping it at `required` means the skip unlocks exactly when the
    network's own ad has finished, which is the rule everywhere else now.
  */
  const skipAt = skipAfterSec === null ? null : Math.min(skipAfterSec, required);
  const canSkip = skipAt !== null && watched >= skipAt - 0.4;
  const skipIn = skipAt === null ? 0 : Math.max(0, Math.ceil(skipAt - watched));

  const onLoadedMeta = () => {
    const v = videoRef.current;
    if (!v) return;
    const d = Number.isFinite(v.duration) && v.duration > 1 ? v.duration : durationSec;
    setRequired(Math.min(durationSec, d));
  };
  const onTime = () => {
    const v = videoRef.current;
    if (!v) return;
    const t = v.currentTime;
    if (!v.paused && t > lastT.current && t - lastT.current < 1.5) {
      setWatched((w) => Math.min(required, w + (t - lastT.current)));
    }
    lastT.current = t;
  };

  /* Portalled: a `fixed inset-0` overlay is clipped to any transformed,
     filtered or blurred ancestor, which several surfaces have. See
     components/ui/portal.tsx for the full explanation. */
  return (
    <Portal>
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      >
        <motion.div
          initial={{ scale: 0.96, y: 10 }}
          animate={{ scale: 1, y: 0 }}
          className="relative w-full max-w-md overflow-hidden rounded-3xl border border-border bg-card shadow-elevated"
        >
          {/* X — always available so users are never trapped (closing simply
              skips the HD reward). */}
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white transition hover:bg-black/60"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="p-5">
            <h3 className="flex items-center gap-2 text-base font-semibold">
              {done ? (
                <>
                  <CheckCircle2 className="h-5 w-5 text-green-500" /> Reward unlocked
                </>
              ) : (
                <>
                  <Lock className="h-5 w-5 text-primary" /> Watch a short ad to download in HD
                </>
              )}
              {/* "1 of 2", only when a second ad actually follows. Someone who
                  knows there are two waits differently from someone ambushed by
                  a second one. */}
              {totalSteps && totalSteps > 1 && step ? (
                <span className="ml-auto shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                  {step} of {totalSteps}
                </span>
              ) : null}
            </h3>

            <div className="mt-4 overflow-hidden rounded-2xl bg-black">
              {videoSrc && !errored ? (
                <video
                  ref={videoRef}
                  src={videoSrc}
                  poster={ad.imageUrl ?? undefined}
                  autoPlay
                  muted
                  playsInline
                  controls
                  onLoadedMetadata={onLoadedMeta}
                  onTimeUpdate={onTime}
                  onPlay={() => setPaused(false)}
                  onPause={() => setPaused(true)}
                  onError={() => setErrored(true)}
                  className="aspect-video w-full"
                />
              ) : (
                /*
                  `min-h-[180px]` reserves a black rectangle. That is right while
                  a network ad is loading and wrong once the slot has reported it
                  has nothing — the same decorated-empty-box shape as FetchedAd,
                  latent here because the gate grants immediately when the zone
                  is unseeded, so it only surfaces for an ad row that exists but
                  renders nothing (a `display` ad saved with no script code).
                  Collapsed on a negative answer rather than left to be found.
                */
                <div
                  className={cn(
                    "flex items-center justify-center p-2",
                    slotHasAd === false ? "min-h-0" : "min-h-[180px]",
                  )}
                >
                  <AdSlot
                    zone="reward_video"
                    dismissible={false}
                    className="w-full"
                    onResolved={setSlotHasAd}
                  />
                </div>
              )}
            </div>

            {ad.targetUrl ? (
              <a
                href={ad.targetUrl}
                target="_blank"
                rel="nofollow sponsored noopener"
                onClick={() => beacon("click", ad.id)}
                className="mt-2 block truncate text-center text-xs text-muted-foreground hover:text-foreground"
              >
                Sponsored{ad.headline ? ` · ${ad.headline}` : ""} →
              </a>
            ) : null}

            {/* progress + status */}
            {!done ? (
              <div className="mt-4">
                <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="mt-2 text-center text-sm text-muted-foreground">
                  {paused ? (
                    <span className="inline-flex items-center gap-1 text-amber-500">
                      <Pause className="h-3.5 w-3.5" /> Paused — play to keep unlocking
                    </span>
                  ) : (
                    <>Watch {remaining}s more to unlock HD — or tap ✕ to skip</>
                  )}
                </p>

                {/*
                  SKIP — second ad only. It advances the sequence exactly as a
                  completed watch does (`onReward`), rather than cancelling: the
                  viewer has already earned the download by watching the first ad
                  in full, and dropping them out here would take it away for
                  using an affordance we offered.

                  Counted down rather than appearing without warning, so the wait
                  is legible instead of feeling arbitrary.
                */}
                {skipAfterSec !== null ? (
                  <button
                    type="button"
                    onClick={canSkip ? onReward : undefined}
                    disabled={!canSkip}
                    className="mt-3 w-full rounded-xl border border-border px-4 py-2.5 text-sm font-semibold transition enabled:hover:bg-secondary disabled:opacity-50"
                  >
                    {canSkip ? "Skip ad" : `Skip in ${skipIn}s`}
                  </button>
                ) : null}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  /*
                    "Reward ads watched" — the metric that had no source.

                    Recorded HERE, on the claim, rather than when the timer
                    reaches zero: an ad that ran to completion in a tab nobody
                    came back to is not a reward anyone watched. This fires once
                    per gate (the gate unmounts on reward), and the collector
                    dedups on the event id regardless.
                  */
                  void import("@/lib/analytics/client").then((m) =>
                    m.track("reward_completed", { zone: "reward_video", adId: ad.id, seconds: Math.round(watched) }),
                  );
                  onReward();
                }}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-green-600 px-4 py-3.5 text-base font-semibold text-white shadow-lg transition hover:opacity-90 active:scale-[0.99]"
              >
                <Download className="h-5 w-5" /> Download in HD
              </button>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
    </Portal>
  );
}
