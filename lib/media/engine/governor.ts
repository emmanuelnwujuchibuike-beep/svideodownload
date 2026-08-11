import type { DeviceClass } from "./capabilities";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FrenzStream™ — THE GOVERNOR (Feature 15, Part 2)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * One function decides everything about how a clip is fetched: how tall a
 * rendition may be, how much to buffer ahead and behind, and how far to preload.
 *
 * ── Why one function ───────────────────────────────────────────────────────
 * Those three decisions used to live in three places — the height cap in
 * `network-conditions.ts`, the buffer lengths hardcoded in `hls.ts`, the preload
 * depth hardcoded in the reel deck — and they could disagree, and did. A
 * data-saver viewer got a 480p cap (correct) alongside a 12-second forward
 * buffer and three fully-buffered neighbours (not correct): the cap saved a
 * little data and the buffers spent it again. They are the same decision and
 * they are made together now.
 *
 * ── Why it is pure ─────────────────────────────────────────────────────────
 * No DOM, no timers, no `navigator`, no I/O. The whole signal space is
 * enumerable in tests, which matters because this is a policy with ordering
 * rules — the kind of code where the bug is never in one branch but in which
 * branch wins.
 *
 * ── 🔴 On "monitor CPU, GPU and temperature" ───────────────────────────────
 * The brief asks for those. No browser exposes any of them, so this does not
 * pretend to read them. What it reads is the OBSERVABLE CONSEQUENCE: a rising
 * dropped-frame ratio at a steady bitrate is what thermal throttling, a busy
 * CPU and an over-tall rendition all look like from JavaScript — and all three
 * want the same response, so one signal is enough to act correctly. See
 * `docs/FEATURE_15_PART_2_PLAYBACK_ENGINE.md` §4.
 */

export type QualityPreference = "auto" | "data-saver" | "balanced" | "high";

export interface PlaybackSignals {
  /** The viewer's explicit choice. Always wins over every heuristic. */
  preference: QualityPreference;
  /** OS/browser Data Saver. */
  saveData: boolean;
  /** 'slow-2g' | '2g' | '3g' | '4g', when exposed. */
  effectiveType?: string;
  /** Estimated downlink, when exposed. */
  downlinkMbps?: number;
  /** 0–1, when exposed. */
  batteryLevel?: number;
  /** Whether the device is plugged in, when exposed. */
  charging?: boolean;
  /** Static hardware class from `capabilities.classifyDevice`. */
  deviceClass: DeviceClass;
  /** Times playback has stalled to rebuffer since this clip started. */
  rebuffers?: number;
  /** droppedVideoFrames / totalVideoFrames for this clip, 0–1. */
  droppedFrameRatio?: number;
  /** How many clips the viewer has watched to (near) completion this session. */
  completedClips?: number;
}

export interface PlaybackPolicy {
  /** Never auto-select a rendition taller than this. `null` = no extra cap. */
  maxHeight: number | null;
  /** Seconds to keep buffered ahead of the playhead. */
  forwardBufferSec: number;
  /** Hard ceiling on the forward buffer when bandwidth is plentiful. */
  maxForwardBufferSec: number;
  /** Seconds of already-watched buffer to retain. Bounds memory on a long scroll. */
  backBufferSec: number;
  /** How many clips ahead to mount and give `preload="metadata"`. */
  preloadAhead: number;
  /** How many clips behind to keep mounted, so scrolling back is instant. */
  preloadBehind: number;
  /** Of the clips ahead, how many get `preload="auto"` (real segment bytes). */
  fullyBufferAhead: number;
  /** First-guess bandwidth for hls.js, so startup is neither stuck low nor reckless. */
  startBitrateEstimate: number;
  /** Human-readable trace of which rules fired. Surfaced in diagnostics only. */
  reason: string[];
}

/** The ladder a distressed device walks down, tallest first. */
const STEP_DOWN: number[] = [1080, 720, 480, 360];

/** A dropped-frame ratio above this means the decoder is not keeping up. */
export const DISTRESS_DROPPED_RATIO = 0.08;
/** This many stalls in one clip is a link that cannot hold the current rung. */
export const DISTRESS_REBUFFERS = 3;

function stepDown(from: number | null): number {
  if (from === null) return STEP_DOWN[1]!; // uncapped → straight to 720
  const i = STEP_DOWN.indexOf(from);
  if (i === -1) return STEP_DOWN.find((h) => h < from) ?? STEP_DOWN[STEP_DOWN.length - 1]!;
  return STEP_DOWN[Math.min(i + 1, STEP_DOWN.length - 1)]!;
}

/**
 * The whole policy, in priority order. The FIRST rule that applies to a given
 * output wins, and the order is the design:
 *
 *  1. an explicit user preference is never overridden by a heuristic;
 *  2. a device in distress is never pushed harder by a good bandwidth reading —
 *     this is why distress is evaluated before connection quality, and it is the
 *     case a naive "use the measured bandwidth" ABR gets wrong on a hot phone;
 *  3. then connection, then battery, then device class.
 */
export function decidePolicy(signals: PlaybackSignals): PlaybackPolicy {
  const reason: string[] = [];
  const {
    preference,
    saveData,
    effectiveType,
    batteryLevel,
    charging,
    deviceClass,
    rebuffers = 0,
    droppedFrameRatio = 0,
    completedClips = 0,
  } = signals;

  // ── 1. Explicit preference ────────────────────────────────────────────────
  if (preference === "data-saver") {
    reason.push("preference:data-saver");
    return {
      maxHeight: 480,
      forwardBufferSec: 6,
      maxForwardBufferSec: 10,
      backBufferSec: 2,
      // Still mount one either side: an unmounted neighbour means a black frame
      // on the next swipe, which is a worse experience than the few KB of
      // metadata it costs. What data-saver removes is SEGMENT prefetch, below.
      preloadAhead: 1,
      preloadBehind: 1,
      fullyBufferAhead: 0,
      startBitrateEstimate: 500_000,
      reason,
    };
  }

  const unplugged = charging === false;
  const critical = unplugged && batteryLevel !== undefined && batteryLevel <= 0.1;
  const low = unplugged && batteryLevel !== undefined && batteryLevel <= 0.2;
  const distressed =
    droppedFrameRatio >= DISTRESS_DROPPED_RATIO || rebuffers >= DISTRESS_REBUFFERS;

  // ── 2. Ceiling ────────────────────────────────────────────────────────────
  let maxHeight: number | null;
  if (preference === "high") {
    maxHeight = null;
    reason.push("preference:high");
  } else if (preference === "balanced") {
    maxHeight = 720;
    reason.push("preference:balanced");
  } else if (saveData) {
    maxHeight = 480;
    reason.push("saveData");
  } else if (effectiveType === "slow-2g" || effectiveType === "2g") {
    maxHeight = 360;
    reason.push(`connection:${effectiveType}`);
  } else if (effectiveType === "3g") {
    maxHeight = 720;
    reason.push("connection:3g");
  } else if (critical) {
    maxHeight = 480;
    reason.push("battery:critical");
  } else if (low) {
    maxHeight = 720;
    reason.push("battery:low");
  } else if (deviceClass === "low") {
    maxHeight = 720;
    reason.push("device:low");
  } else {
    maxHeight = null;
  }

  /*
    Distress steps the ceiling DOWN from wherever the rules above put it, and it
    applies even under `preference: "high"`.

    That is not overriding the viewer's choice — "Best Quality" is a request for
    the best WATCHABLE quality, and a rung the decoder is dropping 8% of the
    frames from is not being watched at that quality, it is stuttering at it.
    Left alone the device gets hotter and the ABR estimate, which measures the
    NETWORK, keeps insisting the rung is fine.
  */
  if (distressed) {
    maxHeight = stepDown(maxHeight);
    reason.push(
      droppedFrameRatio >= DISTRESS_DROPPED_RATIO
        ? `distress:dropped-frames:${droppedFrameRatio.toFixed(2)}`
        : `distress:rebuffers:${rebuffers}`,
    );
  }

  // ── 3. Buffers ────────────────────────────────────────────────────────────
  // A longer buffer survives a worse network but costs memory and decode-ahead,
  // so it tracks the constraint that is actually binding.
  let forwardBufferSec = 12;
  let maxForwardBufferSec = 24;
  let backBufferSec = 6;

  if (effectiveType === "slow-2g" || effectiveType === "2g" || effectiveType === "3g") {
    // Counter-intuitive but correct: a WEAK link wants a LONGER runway, because
    // the failure is a stall and the buffer is the only thing standing between
    // the viewer and one. The height cap is what protects the data bill.
    forwardBufferSec = 20;
    maxForwardBufferSec = 40;
    reason.push("buffer:extended-for-weak-link");
  }
  if (critical || distressed || deviceClass === "low") {
    // Here the binding constraint is the DEVICE, not the link — buffering ahead
    // means holding more decoded and undecoded data in memory on the machine
    // that is already struggling.
    forwardBufferSec = Math.min(forwardBufferSec, 8);
    maxForwardBufferSec = Math.min(maxForwardBufferSec, 14);
    backBufferSec = 2;
    reason.push("buffer:trimmed-for-device");
  }

  // ── 4. Preload window ─────────────────────────────────────────────────────
  // Depth grows with demonstrated engagement, not with bandwidth alone: someone
  // flicking past six clips in four seconds discards everything we prefetch.
  const engaged = completedClips >= 3;
  let preloadAhead = engaged ? 3 : 2;
  let fullyBufferAhead = engaged ? 2 : 1;
  /*
    Always exactly one, in every policy, and there is a test that asserts it
    across the whole signal space. An unmounted previous clip means a black frame
    while it re-fetches when someone scrolls back, and the few KB of metadata it
    costs is never what makes a device struggle. Kept as a named value rather
    than a literal at the return so the invariant is visible here.
  */
  const preloadBehind = 1;

  if (deviceClass === "low" || low || distressed) {
    preloadAhead = 1;
    fullyBufferAhead = 1;
    reason.push("preload:shallow");
  }
  if (critical || effectiveType === "slow-2g" || effectiveType === "2g") {
    preloadAhead = 1;
    fullyBufferAhead = 0;
    reason.push("preload:none");
  }
  if (preference === "high" && !distressed && deviceClass === "high") {
    preloadAhead = 4;
    fullyBufferAhead = 3;
    reason.push("preload:deep");
  }

  // ── 5. Startup bandwidth guess ────────────────────────────────────────────
  // hls.js picks a start level from this before it has measured anything. Too
  // high and the first segment stalls; too low and the first seconds look soft
  // on a good connection. Seeded from the connection class rather than a
  // constant.
  const startBitrateEstimate =
    effectiveType === "slow-2g" || effectiveType === "2g"
      ? 250_000
      : effectiveType === "3g"
        ? 750_000
        : 1_500_000;

  return {
    maxHeight,
    forwardBufferSec,
    maxForwardBufferSec,
    backBufferSec,
    preloadAhead,
    preloadBehind,
    fullyBufferAhead,
    startBitrateEstimate,
    reason,
  };
}

/**
 * Whether a NEW policy is different enough from the running one to be worth
 * applying mid-playback.
 *
 * Reconfiguring the player is not free — it can nudge the ABR controller and, if
 * done every time a battery reading ticks, produces exactly the visible quality
 * oscillation the brief asks to avoid ("avoid noticeable quality switching").
 * Only a ceiling change or a materially different buffer is worth it.
 */
export function policyChanged(a: PlaybackPolicy, b: PlaybackPolicy): boolean {
  return (
    a.maxHeight !== b.maxHeight ||
    Math.abs(a.forwardBufferSec - b.forwardBufferSec) >= 4 ||
    a.fullyBufferAhead !== b.fullyBufferAhead ||
    a.preloadAhead !== b.preloadAhead
  );
}

/**
 * Recovery is deliberately SLOWER than degradation.
 *
 * A device steps down the moment it is in distress, but only steps back up
 * after a sustained clean window. Oscillating between rungs is both more visible
 * and more expensive than sitting one rung low for a few extra seconds, and a
 * device that just thermally throttled is very likely to do it again.
 */
export const RECOVERY_CLEAN_SAMPLES = 5;
