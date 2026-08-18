"use client";

import { motion } from "framer-motion";

import { haptic, type HapticIntent } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

import { reelMotion } from "./design";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE BARE ACTION-RAIL BUTTON (Feature 15 Part 1, restyled 2026-08-18)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 🔴 GLASS DISC REMOVED (owner, 2026-08-18: "remove the existing glass
 * background from the engagement tray icon" — matching a reference Instagram
 * Reels screenshot, where every rail icon sits bare on the video with no
 * circular backing at all). This used to wrap each glyph in a blurred,
 * tinted, ring-lined disc (`glass.primary` from design.ts) with a ripple and
 * a soft glow layered inside it. All three were disc-dependent effects with
 * nothing to draw on once the disc was gone, so they left with it rather than
 * being reimplemented as free-floating versions of themselves.
 *
 * What's left, and why it's still enough to feel deliberate rather than
 * unfinished:
 *  • A `drop-shadow` on the glyph itself — the legibility job the glass used
 *    to do (contrast against any video frame), without needing a background.
 *  • ADAPTIVE COLOUR — the active state still tints from `--reel-accent`, the
 *    Living Interface™ variable, so a liked button is lit by the video rather
 *    than by a hardcoded violet.
 *  • MICRO BOUNCE / SPRING — `whileTap` on the app's shared `press` spring.
 *  • HAPTICS — routed through the app's `haptic()` vocabulary.
 *
 * ── Reduced motion ────────────────────────────────────────────────────────
 * The bounce is suppressed by `motion-reduce`; the button keeps its colour
 * change — the feedback survives, only the movement stops.
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
  /** Diameter of the button's touch target/focus ring, in px. */
  size = 48,
  /**
   * The glyph inside the disc. It is a CLASS and not a number derived from
   * `size` on purpose: several of the icons rendered here (the Wow faces, the
   * emotion glyphs) are hand-written components that forward `className` and
   * nothing else, so an inline `style` would be silently dropped on exactly the
   * buttons the rail uses most and they would render at their intrinsic size.
   *
   * Shrink it whenever `size` shrinks — a 42px disc around a 24px glyph reads
   * as a cramped 48px button rather than as a smaller one.
   */
  glyphClassName = "h-6 w-6",
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
  glyphClassName?: string;
  hapticIntent?: HapticIntent;
  /** Long-press handlers, spread onto the button. */
  press?: Record<string, unknown>;
  className?: string;
  /** Custom content instead of an icon (e.g. the avatar). */
  children?: React.ReactNode;
}) {
  const handle = (e: React.MouseEvent) => {
    haptic(hapticIntent);
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
          "relative flex items-center justify-center rounded-full transition-colors",
          // Focus must be visible on a video of any colour — a white ring alone
          // can vanish on a white frame, so it carries its own dark offset.
          "group-focus-visible/gb:ring-2 group-focus-visible/gb:ring-white",
        )}
      >
        {children ??
          (Icon ? (
            <Icon
              className={cn(
                "relative transition-colors drop-shadow-[0_2px_5px_rgba(0,0,0,0.5)]",
                glyphClassName,
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
