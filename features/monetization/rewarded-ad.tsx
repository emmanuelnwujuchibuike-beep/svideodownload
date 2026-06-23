"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Download, Lock, Pause, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { AdSlotData } from "@/lib/monetization/types";

import { AdSlot } from "./ad-slot";

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
  onReward,
  onCancel,
}: {
  open: boolean;
  durationSec?: number;
  onReward: () => void;
  onCancel: () => void;
}) {
  const [ad, setAd] = useState<AdSlotData | null | undefined>(undefined);
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

  // Beacon an impression once we have an ad.
  useEffect(() => {
    if (ad && ad.id) beacon("impression", ad.id);
  }, [ad]);

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

  return (
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
          {/* X — only after the ad is watched */}
          {done ? (
            <button
              type="button"
              onClick={onCancel}
              aria-label="Close"
              className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white transition hover:bg-black/60"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}

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
                <div className="flex min-h-[180px] items-center justify-center p-2">
                  <AdSlot zone="reward_video" dismissible={false} className="w-full" />
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
                    <>Keep watching — {remaining}s left to unlock your HD download</>
                  )}
                </p>
              </div>
            ) : (
              <button
                type="button"
                onClick={onReward}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-green-600 px-4 py-3.5 text-base font-semibold text-white shadow-lg transition hover:opacity-90 active:scale-[0.99]"
              >
                <Download className="h-5 w-5" /> Download in HD
              </button>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
