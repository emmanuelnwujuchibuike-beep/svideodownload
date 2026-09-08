"use client";

import { useId } from "react";

import type { PresenceLevel } from "@/lib/ai/presence";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE FRENZ AI CORE — the mark this product is recognised by
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-07: a distinctive Frenz AI intelligence icon — abstract,
 * elegant, futuristic, slightly organic, capable of animation. Explicitly NOT
 * Gemini's, and not any other company's.
 *
 * ── What it is, and why this shape ───────────────────────────────────────────
 *
 * An APERTURE, not a star. Three tapered blades sweep around a luminous centre
 * on a shared axis — the geometry of a lens opening, drawn with the soft
 * asymmetry of something grown rather than machined.
 *
 * A four-pointed sparkle is the obvious choice and the wrong one: it is what
 * every AI product on the market currently uses, it says "magic", and it would
 * make Frenz AI look like a follower of whichever one the viewer saw last. An
 * aperture says something truer about what this tool actually does — it looks
 * at an image and decides what belongs in it. It is also, usefully, a shape
 * nobody else in this category owns.
 *
 * The blades are rotationally symmetric at 120°, so the orbit animation is one
 * rotation of one group: no per-blade tweening, no JavaScript, one compositor
 * layer.
 *
 * ── 🔴 IT ANIMATES WITHOUT RE-RENDERING ──────────────────────────────────────
 *
 * Every moving part reads CSS custom properties an ancestor sets from
 * `lib/ai/presence.ts`. React is not involved in a single frame. Changing the
 * environment from calm to working is one inline-style write on one wrapper —
 * not a state change that re-renders an animated tree, which is how ambient
 * motion normally becomes a performance problem.
 *
 * ── Accessibility ────────────────────────────────────────────────────────────
 *
 * Decorative by default and `aria-hidden`: the state it expresses is always
 * written next to it in words (see FrenzAIStatus), and a screen reader hearing
 * "an animated logo" twice is noise. `label` opts one instance into being the
 * accessible name, for the rare case where it stands alone.
 */

export type CoreSize = "sm" | "md" | "lg" | "xl";

const SIZES: Record<CoreSize, { px: number; blade: number }> = {
  sm: { px: 20, blade: 1.6 },
  md: { px: 34, blade: 2 },
  lg: { px: 64, blade: 2.4 },
  xl: { px: 108, blade: 3 },
};

/**
 * One blade, drawn as a tapered arc.
 *
 * A path rather than a stroked circle segment: the taper (wide at the sweep,
 * narrowing into the centre) is what stops this reading as a loading spinner.
 */
const BLADE =
  "M50 12 C 66 18, 76 30, 78 46 C 70 40, 60 36, 50 36 C 50 28, 50 20, 50 12 Z";

export function FrenzAICore({
  presence = "calm",
  size = "lg",
  className,
  label,
}: {
  presence?: PresenceLevel;
  size?: CoreSize;
  className?: string;
  /** Give it an accessible name. Omit wherever the state is already in words. */
  label?: string;
}) {
  const gradientId = useId();
  const glowId = useId();
  const { px, blade } = SIZES[size];
  const still = presence === "dormant" || presence === "faulted";

  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: px, height: px }}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      {/*
        The bloom. A blurred radial behind the mark, scaled by the environment's
        intensity — this is what makes the core look lit rather than drawn, and
        it costs one composited layer that never changes size.
      */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-[-45%] rounded-full blur-xl"
        style={{
          background:
            "radial-gradient(circle, hsl(var(--brand-purple) / 0.55) 0%, hsl(var(--brand-blue) / 0.35) 45%, transparent 70%)",
          opacity: `calc(var(--ai-intensity, 0.3) * 0.9)`,
        }}
      />

      {/* The pulse ring, present only when the environment is doing real work. */}
      {(presence === "working" || presence === "resolving") && (
        <span
          aria-hidden
          className="frenz-ai-pulse pointer-events-none absolute inset-0 rounded-full"
          style={{ boxShadow: "0 0 0 1.5px hsl(var(--brand-blue) / 0.5)" }}
        />
      )}

      <svg viewBox="0 0 100 100" width={px} height={px} className="relative" aria-hidden>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="hsl(var(--brand-blue-accent))" />
            <stop offset="55%" stopColor="hsl(var(--brand-blue))" />
            <stop offset="100%" stopColor="hsl(var(--brand-purple))" />
          </linearGradient>
          <radialGradient id={glowId}>
            <stop offset="0%" stopColor="hsl(var(--brand-blue-accent))" />
            <stop offset="100%" stopColor="hsl(var(--brand-purple))" />
          </radialGradient>
        </defs>

        {/*
          The three blades. ONE rotating group — the animation is a single
          `rotate` on this element, so three shapes cost exactly what one would.
        */}
        <g className={still ? undefined : "frenz-ai-orbit"} style={{ transformOrigin: "50px 50px" }}>
          {[0, 120, 240].map((angle) => (
            <path
              key={angle}
              d={BLADE}
              fill={`url(#${gradientId})`}
              transform={`rotate(${angle} 50 50)`}
              // Each blade sits at a different opacity so the rotation reads as
              // depth — something turning — rather than as a flat pinwheel.
              opacity={angle === 0 ? 0.95 : angle === 120 ? 0.72 : 0.5}
            />
          ))}
        </g>

        {/*
          The centre. It breathes on its own timing, independent of the orbit,
          so the two never lock into a single mechanical rhythm.
        */}
        <g className={still ? undefined : "frenz-ai-breathe"} style={{ transformOrigin: "50px 50px" }}>
          <circle cx="50" cy="50" r={9 + blade} fill={`url(#${glowId})`} opacity="0.28" />
          <circle cx="50" cy="50" r={5.5 + blade * 0.5} fill={`url(#${glowId})`} />
          {/* The specular highlight — the half-pixel that makes it look like
              light rather than a filled circle. */}
          <circle cx="47.5" cy="47" r={1.6 + blade * 0.2} fill="#fff" opacity="0.65" />
        </g>
      </svg>
    </span>
  );
}
