import type { AiCleanStage } from "@/lib/ai/job-stages";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ AI — PRESENCE: how alive the environment is, and why
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-07: Frenz AI should feel "alive when idle, responsive when
 * interacted with, powerful when generating" — an environment with a sense of
 * presence rather than a dashboard.
 *
 * ── One table, not motion scattered across components ────────────────────────
 *
 * Every animated surface — the core, the ambient background, a button's glow —
 * reads its intensity from HERE. Without that, "processing" ends up meaning a
 * slightly different brightness in three components, they drift apart on the
 * next change, and the environment stops feeling like one thing responding.
 *
 * ── 🔴 THE BATTERY RULE DECIDES THE NUMBERS ──────────────────────────────────
 *
 * This project has a standing rule against idle animation: a phone left on a
 * page must not warm up. So the levels are not "how impressive can this look" —
 * they are a budget. `calm` is deliberately near-still (a 24-second cycle nobody
 * consciously sees), and the energetic levels only exist while real work is
 * genuinely happening, which is a bounded few minutes. Nothing here loops fast
 * forever.
 *
 * Every value is a plain number, so this module is pure and testable and the
 * components stay dumb about when to be loud.
 */

export type PresenceLevel =
  /** Nothing to say. Used when the surface is off-screen or motion is refused. */
  | "dormant"
  /** Idle, waiting. The state a page spends most of its life in. */
  | "calm"
  /** The member has given us something. Slightly awake. */
  | "attentive"
  /** Their bytes are moving. */
  | "focused"
  /** Real work is happening elsewhere and we are waiting on it. */
  | "working"
  /** The last stretch — our own machine, seconds not minutes. */
  | "resolving"
  /** Just finished. A brief lift, then back to calm. */
  | "settled"
  /** Something went wrong. Still, dim, not alarming. */
  | "faulted";

export interface PresenceSpec {
  /** 0-1. Drives the ambient glow's opacity and the core's bloom. */
  intensity: number;
  /** Seconds for one full rotation of the core's orbit. Higher = slower. */
  orbitSeconds: number;
  /** Seconds for one breath. The slowest thing on screen when idle. */
  breathSeconds: number;
  /** Whether the environment emits its occasional energy pulse. */
  pulses: boolean;
  /**
   * Whether ANY continuous motion runs at this level.
   *
   * `false` is not an absence of design — a failed job that kept breathing
   * would read as the product not having noticed.
   */
  animated: boolean;
}

/**
 * The whole visual vocabulary, in one place.
 *
 * The intensities climb slowly and top out well below 1: an interface at full
 * brightness has nowhere left to go, and the difference between `working` and
 * `resolving` has to remain readable at a glance on a phone in daylight.
 */
export const PRESENCE: Record<PresenceLevel, PresenceSpec> = {
  dormant: { intensity: 0, orbitSeconds: 0, breathSeconds: 0, pulses: false, animated: false },
  // 24 seconds. Long enough that the movement is noticed subconsciously before
  // it is noticed consciously, which is exactly the brief.
  calm: { intensity: 0.28, orbitSeconds: 24, breathSeconds: 7, pulses: false, animated: true },
  attentive: { intensity: 0.42, orbitSeconds: 18, breathSeconds: 5.5, pulses: false, animated: true },
  focused: { intensity: 0.58, orbitSeconds: 12, breathSeconds: 4, pulses: false, animated: true },
  working: { intensity: 0.72, orbitSeconds: 8, breathSeconds: 3.2, pulses: true, animated: true },
  resolving: { intensity: 0.86, orbitSeconds: 5, breathSeconds: 2.4, pulses: true, animated: true },
  settled: { intensity: 0.5, orbitSeconds: 20, breathSeconds: 6, pulses: false, animated: true },
  faulted: { intensity: 0.16, orbitSeconds: 0, breathSeconds: 0, pulses: false, animated: false },
};

/**
 * Which presence a job state deserves.
 *
 * Deliberately a total function over the stage union: a new stage added to the
 * job machine without a presence would be a TypeScript error rather than a
 * surface that silently stops responding.
 */
const BY_STAGE: Record<AiCleanStage, PresenceLevel> = {
  idle: "calm",
  uploading: "focused",
  queued: "working",
  processing: "working",
  // Our own worker, and the end is in sight — the one moment the environment
  // is allowed to be at its brightest.
  finalizing: "resolving",
  completed: "settled",
  failed: "faulted",
  cancelled: "calm",
  expired: "calm",
};

export interface PresenceInput {
  stage: AiCleanStage;
  /** True when the member has chosen something but not started it. */
  armed?: boolean;
  /** The viewer asked for less motion. Overrides everything below. */
  reducedMotion?: boolean;
  /** The tab is hidden. Nothing should be moving. */
  hidden?: boolean;
}

/**
 * The level, resolved.
 *
 * 🔴 `reducedMotion` and `hidden` are checked FIRST and win outright. A
 * preference that could be overridden by an interesting state is not a
 * preference, and an animation that keeps running in a background tab is a
 * battery cost paid for something nobody can see.
 */
export function presenceFor(input: PresenceInput): PresenceLevel {
  if (input.reducedMotion) return "dormant";
  if (input.hidden) return "dormant";
  // A chosen file, not yet sent: awake, not working.
  if (input.armed && input.stage === "idle") return "attentive";
  return BY_STAGE[input.stage];
}

/** The numbers for a level. */
export function presenceSpec(level: PresenceLevel): PresenceSpec {
  return PRESENCE[level];
}

/**
 * The CSS custom properties every animated Frenz AI surface reads.
 *
 * Handed down as inline style on ONE wrapper, so a change of state is a single
 * style write on a single element and every descendant follows through CSS —
 * rather than React re-rendering a tree of animated components to change a
 * brightness. That is the difference between this being free and this being the
 * reason a phone gets warm.
 */
export function presenceVars(level: PresenceLevel): Record<string, string> {
  const spec = PRESENCE[level];
  return {
    "--ai-intensity": String(spec.intensity),
    "--ai-orbit": spec.orbitSeconds ? `${spec.orbitSeconds}s` : "0s",
    "--ai-breath": spec.breathSeconds ? `${spec.breathSeconds}s` : "0s",
    "--ai-play": spec.animated ? "running" : "paused",
  };
}
