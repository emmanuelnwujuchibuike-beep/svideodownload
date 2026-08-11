"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Pause } from "lucide-react";

import { cn } from "@/lib/utils";

import { glass, layer, reelMotion } from "./design";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  LIVING PLAYBACK™ (Feature 15, Part 2 — tranche 3)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "Videos begin with elegant fade-ins. Pause introduces a gentle glass ripple.
 *  Resume smoothly restores motion. Animations remain subtle, refined, and never
 *  interfere with the content."
 *
 * ── One component, because these are one behaviour ────────────────────────
 *
 * Fade-in, pause and buffering were three unrelated bits of JSX inside the card:
 * a `slideFade` opacity class, a `<Pause>` glyph, and a `<Loader2>` spinner.
 * Three separate things drawn at the same place at overlapping times, with no
 * shared idea of which one wins — so a clip that stalled WHILE paused showed a
 * pause glyph and a spinner on top of each other.
 *
 * They are one state machine and they are modelled as one here: exactly one
 * indicator is ever on screen, chosen by `phase`.
 *
 * ── Why the pause indicator is a RIPPLE and not just a glyph ──────────────
 *
 * A glyph that appears is a state readout. A ripple that expands from the centre
 * and settles is feedback for the TAP — it tells you the app received your
 * finger, at the moment it received it, which a static glyph cannot. It is drawn
 * once per pause and does not loop: a looping animation over a paused video is
 * the interface talking over the content.
 *
 * ── Why buffering is deliberately understated ─────────────────────────────
 *
 * The brief asks for a "premium animated loader". The premium decision here is
 * DELAY, not decoration: the ring only appears once a stall has lasted long
 * enough to be worth naming (the caller gates this), because a spinner that
 * flashes for 80ms on a fast connection makes a smooth session feel unreliable.
 * When it does appear it is a slow, single-arc sweep rather than a fast spinner,
 * which reads as "loading" rather than "stuck".
 *
 * ── Reduced motion ────────────────────────────────────────────────────────
 *
 * `motion-reduce` drops the movement and keeps the INDICATOR. Removing the
 * feedback along with the animation is the common mistake — it leaves someone
 * unable to tell whether their tap did anything, which is worse than the motion
 * they asked not to see.
 */

export type PlaybackPhase = "playing" | "paused" | "buffering";

export function LivingPlayback({
  phase,
  /** Bumped on each pause so the ripple replays; ignored while playing. */
  pauseKey,
  className,
}: {
  phase: PlaybackPhase;
  pauseKey: number;
  className?: string;
}) {
  return (
    <AnimatePresence mode="wait">
      {phase === "paused" ? (
        <motion.span
          key="paused"
          initial={{ opacity: 0, scale: 0.86 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 1.08 }}
          transition={reelMotion.chrome}
          className={cn(
            "pointer-events-none absolute flex h-16 w-16 items-center justify-center rounded-full text-white",
            glass.primary,
            layer.rail,
            className,
          )}
          aria-hidden
        >
          {/* THE RIPPLE — one expansion per pause, keyed so a second tap replays
              it. `transform`/`opacity` only, so it composites and costs no paint
              on a device that is already decoding video. */}
          <span
            key={pauseKey}
            className="pointer-events-none absolute inset-0 rounded-full bg-white/25 animate-[reel-ripple_620ms_ease-out_forwards] motion-reduce:hidden"
          />
          <Pause className="relative h-7 w-7 fill-white" />
        </motion.span>
      ) : phase === "buffering" ? (
        <motion.span
          key="buffering"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className={cn(
            "pointer-events-none absolute flex h-14 w-14 items-center justify-center rounded-full",
            glass.ambient,
            layer.rail,
            className,
          )}
          role="status"
          aria-label="Buffering"
        >
          {/* A single slow arc, not a fast spinner: speed reads as panic. Drawn
              as a bordered ring so there is no SVG to rasterise. */}
          <span className="h-6 w-6 rounded-full border-2 border-white/25 border-t-white animate-[spin_900ms_linear_infinite] motion-reduce:animate-none" />
        </motion.span>
      ) : null}
    </AnimatePresence>
  );
}

/**
 * The first-frame fade.
 *
 * 🔴 Driven by the video's own `canplay`, not by a timer. A timed fade is a
 * guess about the network, and on a slow connection it uncovers a black box
 * before there is anything to show — the "flash of nothing" that made entering a
 * reel feel broken. The caller flips `ready` from the element's event, so the
 * picture is genuinely there before it is revealed.
 *
 * Opacity only: a scale here would fight `object-cover`'s own framing and make a
 * full-bleed clip visibly breathe on entry.
 */
export const FIRST_FRAME_FADE = "transition-opacity duration-300 ease-out motion-reduce:transition-none";
