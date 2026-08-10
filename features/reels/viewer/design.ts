import type { Transition } from "framer-motion";

import { springs } from "@/lib/motion/springs";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZSAVE REELS — THE VIEWER DESIGN LANGUAGE (Feature 15, Part 1)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * One file that every surface in the viewer reads from, so the experience is a
 * SYSTEM rather than a pile of individually-pretty components. Change a value
 * here and the whole viewer moves together.
 *
 * ── The brief, and what it actually rules out ──────────────────────────────
 *
 * "Do not copy TikTok / Reels / Shorts / Spotlight. Study their strengths and
 * create something that immediately reads as Frenzsave."
 *
 * The thing all four have in common is the same one they all get from the same
 * place: controls are OPAQUE GLYPHS painted directly onto the video, hard against
 * the right edge, at a fixed size, permanently visible. That is a decision made
 * for 2016 phones — small screens, weak GPUs, no safe areas — and every one of
 * them still ships it.
 *
 * Frenzsave's three departures, and each is a real usability argument, not a
 * style preference:
 *
 *  1. CONTROLS FLOAT ON GLASS, NOT ON VIDEO. A glyph drawn straight onto video is
 *     legible on some frames and invisible on others — the failure is a white
 *     icon on a white shirt, and it is not hypothetical. Every control here sits
 *     on its own blurred surface, so legibility is a property of the CONTROL
 *     rather than a property of whatever frame happens to be underneath.
 *
 *  2. THE RAIL COMES INWARD. See `use-adaptive-rail.ts`. Buttons hard against
 *     the screen edge are the hardest place on a phone for a thumb to reach, and
 *     on a 6.7" device the top of that rail is genuinely out of range.
 *
 *  3. THE UI BORROWS THE VIDEO'S COLOUR. See `use-living-interface.ts`. Nothing
 *     else does this, and it is what will make a Frenzsave screenshot
 *     identifiable at a glance.
 *
 * ── The single rule everything else is subordinate to ──────────────────────
 *
 * THE VIDEO IS THE HERO. Every value below is chosen to stay under that: blurs
 * are heavy enough to guarantee contrast and no heavier, motion is quick enough
 * to feel responsive and short enough to never hold attention, and the chrome
 * removes itself when it is not being used.
 */

/* ═══════════════════════════════════════════════════════════════════════════
 *  MOTION
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Extends `lib/motion/springs.ts` rather than redefining it — the app already
 * has one spring vocabulary and a second one in the viewer would mean the same
 * gesture feeling different depending on which screen you are on.
 *
 * These are the springs that only the viewer needs. They are all SHORT. A
 * premium interface is not one that animates a lot; it is one where the response
 * to your finger is immediate and finished before you think about it. Anything
 * that outlasts the intent behind it reads as sluggish, however beautiful.
 */
export const reelMotion = {
  /** Shared press feedback — same physics as the rest of the app. */
  press: springs.press,

  /**
   * Chrome appearing / disappearing on tap.
   *
   * Critically damped (no overshoot). Chrome that bounces draws the eye, and
   * this is the one animation that plays while someone is trying to WATCH
   * something — it has to be perceivable and then gone.
   */
  chrome: { type: "spring", stiffness: 460, damping: 40, mass: 0.6 } satisfies Transition,

  /**
   * The like burst.
   *
   * The one place a pronounced overshoot is correct: it is a celebration, it is
   * user-initiated, and it is over in under half a second. Uses the app's
   * `elastic` so a burst in the viewer matches a burst in the feed.
   */
  burst: springs.elastic,

  /**
   * The action rail sliding inward when the layout class changes (rotation,
   * unfolding, split-screen resize).
   *
   * Slower and softer than everything else on purpose. This is the one movement
   * the user did NOT ask for — it is the interface reacting to the device — so
   * it should read as the UI settling rather than as something being yanked.
   */
  railShift: { type: "spring", stiffness: 210, damping: 30, mass: 0.9 } satisfies Transition,

  /**
   * Social Pulse™ cards entering and leaving.
   *
   * Deliberately the gentlest motion in the system. A notification that punches
   * in while you are watching a video is an interruption; one that drifts in and
   * dissolves is an ambient signal. The difference is entirely in this curve.
   */
  pulse: { type: "spring", stiffness: 260, damping: 34, mass: 0.8 } satisfies Transition,
} as const;

/**
 * How long the chrome stays up after the last interaction, in ms.
 *
 * 3000 matches the value already used by the reel deck and the fullscreen video
 * player, and the three must agree — the same gesture producing a different
 * timeout on a different surface is the kind of inconsistency nobody reports and
 * everybody feels.
 */
export const CHROME_IDLE_MS = 3000;

/* ═══════════════════════════════════════════════════════════════════════════
 *  GLASS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Three depths, and a control picks one by how important it is — not by taste.
 * Having exactly three is the point: an interface where every surface has its
 * own bespoke blur has no hierarchy, because hierarchy is comparison.
 *
 * 🔴 Every recipe pairs a blur with a TINT and a RING, and all three are
 * load-bearing:
 *
 *  • The blur destroys high-frequency detail so a glyph never competes with
 *    texture behind it.
 *  • The tint guarantees a contrast floor — blur alone does not, because a
 *    blurred white shirt is still white.
 *  • The ring is what separates the surface from the video at its edge; without
 *    it a blurred panel over a blurry video has no boundary and reads as a
 *    smudge rather than as a control.
 *
 * 🔴 `backdrop-blur` is a GPU pass per element. This project has already shipped
 * a bug where a per-item backdrop-blur cost real frames and composited even at
 * `opacity-0` (recorded 2026-08-10). So these are for CHROME — a bounded number
 * of persistent surfaces — and must never be applied per list item or per frame.
 */
export const glass = {
  /**
   * PRIMARY — the action rail buttons and anything else the thumb aims for.
   * The strongest treatment, because these are the smallest targets and the ones
   * that must be findable on any frame.
   */
  primary:
    "bg-white/[0.13] ring-1 ring-inset ring-white/20 backdrop-blur-xl shadow-[0_4px_16px_-4px_rgba(0,0,0,0.5)]",

  /**
   * SECONDARY — information surfaces: the caption panel, the music chip, the
   * time readout. Lighter, because these are read rather than aimed at, and a
   * heavy panel behind a paragraph starts to feel like a modal over the video.
   */
  secondary: "bg-black/25 ring-1 ring-inset ring-white/10 backdrop-blur-md",

  /**
   * AMBIENT — Social Pulse™ and other transient overlays. The lightest, because
   * these arrive uninvited and must never read as something requiring an answer.
   */
  ambient: "bg-black/30 ring-1 ring-inset ring-white/10 backdrop-blur-sm",
} as const;

/**
 * The one shadow the whole viewer uses under glyphs that sit directly on video
 * (the few that legitimately do — the play/pause indicator, the timestamp).
 *
 * A drop shadow rather than a stroke: a stroke changes the glyph's silhouette
 * and makes an icon set look inconsistent at small sizes, while a shadow leaves
 * the shape alone and just guarantees separation from what is behind it.
 */
export const GLYPH_SHADOW = "drop-shadow-[0_1px_3px_rgba(0,0,0,0.55)]";

/* ═══════════════════════════════════════════════════════════════════════════
 *  SMART UI — the contrast floor
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "Bright videos → darker overlays. Dark videos → increase text contrast. Busy
 * backgrounds → strengthen blur."
 *
 * Implemented as ONE number: the sampled luminance of the current frame region
 * behind the chrome, published by `use-living-interface.ts`. Everything else is
 * derived from it, because three independent rules would eventually disagree
 * with each other and produce a state where the UI is both "bright" and "dark".
 *
 * The scrim opacity below is the floor that keeps white text legible. It is
 * deliberately generous at the bright end: the failure modes are asymmetric — a
 * slightly-too-dark scrim costs a little of the picture, a slightly-too-light
 * one costs the caption entirely. Exactly the reasoning already recorded on the
 * wallpaper CTA's scrim, applied to moving pictures.
 */
export function scrimForLuminance(luminance: number): number {
  // luminance is 0 (black) → 1 (white).
  // Clamped rather than linear all the way down: even on a black frame the
  // caption needs SOME separation, because the video is moving and the next
  // frame may not be black.
  const MIN = 0.18;
  const MAX = 0.55;
  return Math.min(MAX, Math.max(MIN, luminance * 0.62 + 0.14));
}

/**
 * Is this frame bright enough that white-on-video would fail without help?
 *
 * 0.55 is where white text on a photographic background stops clearing 4.5:1
 * against typical mid-tones. Used to switch the few glyphs that sit directly on
 * video (not on glass) to their dark variant.
 */
export function isBrightFrame(luminance: number): boolean {
  return luminance > 0.55;
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  Z-LAYERS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Named, because the viewer stacks nine things over a video and "z-40" appearing
 * in nine files is how a control ends up behind a scrim with nobody able to say
 * why. The gaps are intentional — room to insert without renumbering.
 */
export const layer = {
  video: "z-0",
  scrim: "z-10",
  /** Tap/seek surface — above the scrim, below every control. */
  gestures: "z-20",
  info: "z-30",
  rail: "z-40",
  progress: "z-50",
  pulse: "z-[55]",
  /*
    🔴 `z-[60]`, NOT `z-60`.

    Tailwind's default z scale stops at 50, so `z-60` is not a class — it emits
    NO CSS, and the element falls back to `z-index: auto`. It compiles, it lints,
    it builds, and it silently does nothing. Caught by looking at the running
    page: the tab bar was in the DOM, `display: flex`, `opacity: 1`, and
    `elementFromPoint` at its own centre returned the VIDEO, because the video's
    `z-10` beat `auto`.

    This is the exact trap already recorded for this codebase (undefined tokens
    that pass every check and produce nothing). The arbitrary-value form is a
    real declaration, which is why `pulse` and `sheet` below were already written
    that way — this one was the odd one out.
  */
  topNav: "z-[60]",
  sheet: "z-[100]",
} as const;
