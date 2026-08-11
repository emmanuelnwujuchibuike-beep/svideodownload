"use client";

import { getMediaCapabilities } from "./capabilities";
import { decidePolicy, type PlaybackPolicy, type PlaybackSignals, type QualityPreference } from "./governor";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FrenzStream™ — SIGNAL ADAPTER (Feature 15, Part 2)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The one place that talks to `navigator` and turns it into the pure
 * `PlaybackSignals` the governor consumes. Everything with a branch in it lives
 * on the other side of this boundary, in `governor.ts`, where it is testable;
 * everything here is a read with a fallback and has nothing to get wrong.
 *
 * ── Synchronous first, refined after ───────────────────────────────────────
 * `readSignalsSync` never awaits, because instant playback must not wait on the
 * promise-based Battery API — the correct behaviour is to start at a
 * network-appropriate ceiling immediately and refine a moment later. That is why
 * there are two readers rather than one async one.
 *
 * ── Session counters ───────────────────────────────────────────────────────
 * `completedClips` is module-level, not React state. It is a property of the
 * SESSION, every player surface contributes to it, and putting it in state would
 * re-render a deck on a counter tick — the same reasoning as
 * `resume-positions.ts` and the deck's `lastReelsFetchAt`.
 */

interface NavigatorConnection {
  saveData?: boolean;
  effectiveType?: string;
  downlink?: number;
}

interface BatteryLike {
  charging: boolean;
  level: number;
}

function readConnection(): NavigatorConnection | undefined {
  if (typeof navigator === "undefined") return undefined;
  const nav = navigator as Navigator & {
    connection?: NavigatorConnection;
    mozConnection?: NavigatorConnection;
    webkitConnection?: NavigatorConnection;
  };
  return nav.connection ?? nav.mozConnection ?? nav.webkitConnection;
}

/*
  The battery reading is cached for a short window.

  `navigator.getBattery()` resolves a live object, and calling it per clip in a
  scrolling deck means a promise and a permission-ish check per swipe. Battery
  level does not move meaningfully inside 30 seconds, so one read serves every
  clip in that window — the same coalescing rule the download manager needed
  (2026-08-10) applied to a different per-item cost.
*/
let batteryCache: { at: number; value: BatteryLike | null } | null = null;
const BATTERY_TTL_MS = 30_000;

async function readBattery(): Promise<BatteryLike | null> {
  if (batteryCache && Date.now() - batteryCache.at < BATTERY_TTL_MS) return batteryCache.value;
  let value: BatteryLike | null = null;
  try {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
    if (typeof nav.getBattery === "function") {
      const b = await nav.getBattery();
      value = { charging: b.charging, level: b.level };
    }
  } catch {
    /* unavailable — the governor treats undefined as "no battery constraint" */
  }
  batteryCache = { at: Date.now(), value };
  return value;
}

/** Clips watched to (near) completion this session — the engagement signal. */
let completedClips = 0;
export function recordClipCompleted(): void {
  completedClips += 1;
}
/** Test seam. */
export function __resetSessionCounters(): void {
  completedClips = 0;
  batteryCache = null;
}

export interface LiveTelemetry {
  rebuffers?: number;
  droppedFrameRatio?: number;
}

function baseSignals(preference: QualityPreference, live: LiveTelemetry): PlaybackSignals {
  const conn = readConnection();
  return {
    preference,
    saveData: !!conn?.saveData,
    effectiveType: conn?.effectiveType,
    downlinkMbps: typeof conn?.downlink === "number" ? conn.downlink : undefined,
    deviceClass: getMediaCapabilities().deviceClass,
    completedClips,
    rebuffers: live.rebuffers,
    droppedFrameRatio: live.droppedFrameRatio,
  };
}

/** Everything readable without awaiting. Used at attach time. */
export function readSignalsSync(preference: QualityPreference, live: LiveTelemetry = {}): PlaybackSignals {
  const s = baseSignals(preference, live);
  // A cached battery reading is free, so use it when one is already warm — this
  // is what makes the SECOND clip of a session start with the full picture.
  if (batteryCache?.value) {
    s.batteryLevel = batteryCache.value.level;
    s.charging = batteryCache.value.charging;
  }
  return s;
}

/** The full picture, including the promise-based Battery API. */
export async function readSignals(preference: QualityPreference, live: LiveTelemetry = {}): Promise<PlaybackSignals> {
  const s = baseSignals(preference, live);
  const battery = await readBattery();
  if (battery) {
    s.batteryLevel = battery.level;
    s.charging = battery.charging;
  }
  return s;
}

/** Convenience: the synchronous policy for right now. */
export function currentPolicySync(preference: QualityPreference, live: LiveTelemetry = {}): PlaybackPolicy {
  return decidePolicy(readSignalsSync(preference, live));
}

/**
 * Live dropped-frame ratio for an element.
 *
 * 🔴 This is the closest the web gets to a thermal reading, and the difference
 * matters: it measures the CONSEQUENCE of throttling, not the temperature. A
 * decoder that cannot keep up drops frames, and thermal throttling, a busy CPU
 * and a rendition too tall for the device all produce that same signature — so
 * one number is enough to respond correctly to all three.
 *
 * Returns 0 when the browser does not implement `getVideoPlaybackQuality`, or
 * before enough frames have been decoded to mean anything: a 1-of-3 dropped
 * start-up frame is a 33% ratio and says nothing at all.
 */
export const MIN_FRAMES_FOR_RATIO = 60;

export function droppedFrameRatio(video: HTMLVideoElement | null): number {
  if (!video || typeof video.getVideoPlaybackQuality !== "function") return 0;
  try {
    const q = video.getVideoPlaybackQuality();
    if (!q.totalVideoFrames || q.totalVideoFrames < MIN_FRAMES_FOR_RATIO) return 0;
    return q.droppedVideoFrames / q.totalVideoFrames;
  } catch {
    return 0;
  }
}
