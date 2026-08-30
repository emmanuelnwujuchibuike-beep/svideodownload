"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { effectiveSkipSeconds, type AdTiming } from "@/lib/monetization/ad-timing";

/**
 * The countdown every gated ad overlay runs, obeying the network's own timer.
 *
 * Owner, 2026-08-30: "make same rule for the exoclick and others video ad in
 * wallpaper download reward video or anywhere that is on 30sec or 10secs to be
 * skipable when the ad finishes in the ad network, admin timer set up should
 * only be a fallback."
 *
 * ── What this replaced ────────────────────────────────────────────────────────
 *
 * Each gate ran its own `setInterval` decrementing from an admin number, with no
 * idea what it was gating. A 10-second wallpaper gate over a 6-second ExoClick
 * fill left four seconds of "Skip in 4…3…" on a finished, frozen video; a 30s
 * HD gate over a 12s fill left eighteen. The visitor is being held past the end
 * of the thing they are being held for.
 *
 * ── Three ways the gate opens, in priority order ──────────────────────────────
 *
 *  1. The ad ENDED. The network's own timer ran out — the authoritative signal,
 *     and the one the owner named. Opens immediately.
 *  2. The ad's DURATION is known and shorter than the admin number, so the
 *     countdown targets the ad's length instead (`effectiveSkipSeconds`).
 *  3. Neither is known — a display creative has no timeline at all. The admin
 *     number stands. This is the fallback the owner means, not the default path.
 *
 * ── Why it is still a wall clock underneath ───────────────────────────────────
 *
 * Unlike the VAST overlay, a gate does not own the `<video>` — the creative is
 * several components down, inside `AdSlot`. It learns duration and end through
 * `onAdTiming` but has no position to read, so it counts wall time and lets
 * signal (1) cut it short. That is the correct trade here: the failure a
 * playback clock protects against (buffering) is bounded by signal (1) arriving
 * late, whereas a stalled playback clock with no wall clock would trap the
 * visitor — the one outcome a full-screen overlay must never produce.
 */
export function useAdGateCountdown({
  fallbackSeconds,
  running,
}: {
  /** The admin-configured number. A ceiling, and only used when nothing better is known. */
  fallbackSeconds: number;
  /** Count only while the creative is genuinely on screen. */
  running: boolean;
}): { remaining: number; canSkip: boolean; onAdTiming: (timing: AdTiming) => void } {
  const [elapsed, setElapsed] = useState(0);
  const [adSeconds, setAdSeconds] = useState<number | null>(null);
  const [ended, setEnded] = useState(false);
  /**
   * Whether the gate is currently open, readable from the stable `onAdTiming`
   * callback. A player that reports `ended` after the gate has closed would
   * otherwise leave `ended: true` sitting in state, and the NEXT download's gate
   * would open instantly on the previous ad's ending.
   */
  const runningRef = useRef(running);

  // A second download gets its own countdown, and its own ad's timing — holding
  // the last ad's duration would gate the next one on a creative that is gone.
  useEffect(() => {
    runningRef.current = running;
    if (running) return;
    setElapsed(0);
    setAdSeconds(null);
    setEnded(false);
  }, [running]);

  const target = effectiveSkipSeconds({
    configuredSeconds: fallbackSeconds,
    vastDurationSeconds: adSeconds,
  });
  const remaining = ended ? 0 : Math.max(0, Math.ceil(target - elapsed));

  useEffect(() => {
    if (!running || remaining <= 0) return;
    /*
      250ms, not 1000ms. The tick has to be finer than the unit it displays,
      because `target` can SHRINK underneath it: a `loadedmetadata` arriving at
      t=2.1s on a 3-second ad must not leave "Skip in 1" on screen for most of a
      second after the ad has already finished.
    */
    const id = setInterval(() => setElapsed((e) => e + 0.25), 250);
    return () => clearInterval(id);
  }, [running, remaining]);

  const onAdTiming = useCallback((timing: AdTiming) => {
    // A report from an ad the gate has already closed on must not carry into
    // the next one — see `runningRef`.
    if (!runningRef.current) return;
    if (typeof timing.durationSeconds === "number") setAdSeconds(timing.durationSeconds);
    if (timing.ended) setEnded(true);
  }, []);

  return { remaining, canSkip: remaining <= 0, onAdTiming };
}
