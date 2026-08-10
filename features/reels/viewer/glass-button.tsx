"use client";

import { motion } from "framer-motion";
import { useRef, useState } from "react";

import { haptic, type HapticIntent } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

import { glass, reelMotion } from "./design";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE PREMIUM INTERACTION BUTTON (Feature 15, Part 1)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "Rounded glass background, dynamic blur, soft glow, adaptive colour, premium
 *  shadow, micro bounce, spring motion, luxury ripple, high-quality haptics,
 *  120 FPS where supported."
 *
 * Every control in the action rail is one of these, so the whole rail is
 * consistent by construction rather than by nine components agreeing.
 *
 * ── How each of those is actually delivered ────────────────────────────────
 *
 *  • GLASS + BLUR + SHADOW — one recipe from `design.ts`, not per-button values.
 *  • ADAPTIVE COLOUR — the active state tints from `--reel-accent`, the Living
 *    Interface™ variable, so a liked button is lit by the video rather than by a
 *    hardcoded violet. Falls back to the brand violet when no tint was sampled.
 *  • MICRO BOUNCE / SPRING — `whileTap` on the app's shared `press` spring, so a
 *    press here feels identical to a press anywhere else in Frenzsave.
 *  • RIPPLE — a scale+fade ring, drawn only on press and self-cleaning.
 *  • HAPTICS — routed through the app's `haptic()` vocabulary rather than raw
 *    `navigator.vibrate`, so intents stay consistent and the user's reduce-motion
 *    / OS settings are honoured in one place.
 *
 * ── 120 FPS, honestly ──────────────────────────────────────────────────────
 *
 * There is no web API to request a refresh rate; a page gets the display's rate
 * from rAF. What a developer actually controls is whether a frame can BE cheap,
 * and that is a real constraint honoured here: everything animated is `transform`
 * and `opacity` only — no width, no filter, no box-shadow animation — so frames
 * are composited without layout or paint and the browser can hit whatever the
 * panel supports. Claiming more than that would be marketing.
 *
 * ── Reduced motion ────────────────────────────────────────────────────────
 *
 * The ripple and the bounce are suppressed by `motion-reduce`, and the button
 * keeps its colour change — the FEEDBACK survives, only the movement stops.
 * Removing the feedback along with the motion is the common mistake and it
 * leaves the user unable to tell whether their tap registered.
 */

export function GlassButton({
  icon: Icon,
  label,
  onClick,
  active = false,
  fill = false,
  activeClassName,
  count,
  countNode,
  size = 48,
  hapticIntent = "light",
  press,
  className,
  children,
}: {
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  /** The accessible name. Required — these are icon-only controls. */
  label: string;
  onClick?: (e: React.MouseEvent) => void;
  active?: boolean;
  /** Fill the glyph when active (hearts, bookmarks). */
  fill?: boolean;
  /** Colour for the active glyph. Defaults to the adaptive accent. */
  activeClassName?: string;
  count?: number;
  /**
   * Render the count yourself — for the rail, which uses `AnimatedCount` so a
   * like ticks up instead of jumping. Wins over `count` when both are given.
   */
  countNode?: React.ReactNode;
  size?: number;
  hapticIntent?: HapticIntent;
  /** Long-press handlers, spread onto the button. */
  press?: Record<string, unknown>;
  className?: string;
  /** Custom content instead of an icon (e.g. the avatar). */
  children?: React.ReactNode;
}) {
  const [ripples, setRipples] = useState<number[]>([]);
  const seq = useRef(0);

  const handle = (e: React.MouseEvent) => {
    haptic(hapticIntent);
    // The ripple is keyed and removes itself — no timer cleanup to leak, and no
    // array that grows for the lifetime of the reel.
    const id = seq.current++;
    setRipples((r) => [...r, id]);
    onClick?.(e);
  };

  return (
    <motion.button
      type="button"
      onClick={handle}
      aria-label={label}
      aria-pressed={active}
      whileTap={{ scale: 0.86 }}
      transition={reelMotion.press}
      className={cn("group/gb flex flex-col items-center gap-1 text-white outline-none", className)}
      {...press}
    >
      <span
        style={{ width: size, height: size }}
        className={cn(
          "relative flex items-center justify-center overflow-hidden rounded-full transition-colors",
          glass.primary,
          active && "bg-white/20 ring-white/30",
          // Focus must be visible on a video of any colour — a white ring alone
          // can vanish on a white frame, so it carries its own dark offset.
          "group-focus-visible/gb:ring-2 group-focus-visible/gb:ring-white",
        )}
      >
        {/* RIPPLE — transform+opacity only, so it composites. */}
        {ripples.map((id) => (
          <span
            key={id}
            aria-hidden
            onAnimationEnd={() => setRipples((r) => r.filter((x) => x !== id))}
            className="pointer-events-none absolute inset-0 animate-[reel-ripple_460ms_ease-out_forwards] rounded-full bg-white/35 motion-reduce:hidden"
          />
        ))}

        {/* SOFT GLOW behind an active control, tinted by the video. Sits under
            the glyph and is `opacity`-animated only. */}
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 rounded-full bg-[hsl(var(--reel-accent,265_85%_65%))] blur-md transition-opacity duration-300",
            active ? "opacity-40" : "opacity-0",
          )}
        />

        {children ??
          (Icon ? (
            <Icon
              className={cn(
                "relative h-6 w-6 transition-colors",
                fill && active && "fill-current",
                active
                  ? (activeClassName ?? "text-[hsl(var(--reel-accent,265_85%_65%))]")
                  : "text-white",
              )}
              strokeWidth={2.1}
            />
          ) : null)}
      </span>

      {countNode ??
        (count !== undefined && count > 0 ? (
          <span className="text-[11px] font-bold tabular-nums text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
            {count > 999 ? `${(count / 1000).toFixed(count > 9999 ? 0 : 1)}k` : count}
          </span>
        ) : null)}
    </motion.button>
  );
}
