"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useRef, useState } from "react";

import { haptic } from "@/lib/motion/haptics";
import { springs } from "@/lib/motion/springs";
import { cn } from "@/lib/utils";

import { RepostGlyph } from "./repost-glyph";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE PREMIUM REPOST BUTTON (Feature 15 · Part 4)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "Rounded glass button, dual arrow icon, electric blue glow, purple accent,
 *  luxury shadow, adaptive blur, premium ripple, elegant spring animation,
 *  soft haptic."
 *
 * ── 🔴 Why this is a component and NOT a new button on the reels rail ─────
 * On 2026-08-11 the owner moved Repost INSIDE Send — "put the reshare button
 * inside the send button to avoid tray cluster". Adding a distinct glass Repost
 * control back onto the rail would undo an instruction from the same week and
 * rebuild exactly the clutter it removed.
 *
 * So this is the button everywhere reposting is the PRIMARY action and has room
 * to be one: the destination sheet's hero control, the quote composer's
 * confirm, the repost page. The rail keeps the owner's Send fork, which now
 * opens the sheet this button leads.
 *
 * ── How each brief item is actually delivered ────────────────────────────
 *  • GLASS + ADAPTIVE BLUR — `backdrop-blur` over a translucent fill, so it
 *    takes on whatever is behind it rather than carrying its own opaque plate.
 *  • ELECTRIC BLUE GLOW + PURPLE ACCENT — the brand pair, as a blurred radial
 *    UNDER the disc. Animated on `opacity` only, never on `box-shadow`: a
 *    shadow animation repaints every frame and is the usual reason a "premium"
 *    button janks.
 *  • LUXURY SHADOW — static, layered, never animated (same reason).
 *  • ELEGANT SPRING — `springs.press`, the app's shared vocabulary. There were
 *    seven hand-rolled copies of this spring before that token existed; an
 *    eighth here would be the same mistake.
 *  • PREMIUM RIPPLE — a scale+fade ring, drawn only on press, self-cleaning by
 *    `onAnimationEnd` so there is no timer to leak and no array that grows.
 *  • SOFT HAPTIC — through `haptic()`, so intent stays consistent app-wide.
 *
 * ── 120 FPS, honestly ────────────────────────────────────────────────────
 * No web API requests a refresh rate. What is actually controlled is whether a
 * frame can BE cheap: everything animated here is `transform` and `opacity`,
 * so frames composite without layout or paint. Claiming more would be
 * marketing.
 *
 * ── Reduced motion ───────────────────────────────────────────────────────
 * The ripple and the bounce stop; the colour, the glow and the pressed state
 * remain. Dropping the feedback along with the motion is the common mistake and
 * it leaves people unable to tell whether their tap registered.
 */
export function RepostButton({
  onClick,
  active = false,
  label,
  size = "md",
  variant = "glass",
  count,
  busy = false,
  disabled = false,
  press,
  className,
}: {
  onClick?: (e: React.MouseEvent) => void;
  /** The viewer has already reposted this. */
  active?: boolean;
  /** Accessible name. Required — the compact variants are icon-only. */
  label: string;
  size?: "sm" | "md" | "lg";
  /** `glass` sits on media; `solid` sits on a sheet. */
  variant?: "glass" | "solid";
  count?: number;
  busy?: boolean;
  disabled?: boolean;
  /** Long-press handlers, spread onto the button. */
  press?: Record<string, unknown>;
  className?: string;
}) {
  const [ripples, setRipples] = useState<number[]>([]);
  const seq = useRef(0);
  const reduceMotion = useReducedMotion();

  const dims = size === "lg" ? 56 : size === "sm" ? 36 : 46;
  const glyph = size === "lg" ? "h-7 w-7" : size === "sm" ? "h-[18px] w-[18px]" : "h-6 w-6";

  const handle = (e: React.MouseEvent) => {
    if (disabled || busy) return;
    haptic(active ? "light" : "medium");
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
      aria-busy={busy || undefined}
      disabled={disabled}
      whileTap={reduceMotion || disabled ? undefined : { scale: 0.9 }}
      transition={springs.press}
      className={cn(
        "group/rp inline-flex flex-col items-center gap-1 outline-none disabled:opacity-40",
        className,
      )}
      {...press}
    >
      <span
        style={{ width: dims, height: dims }}
        className={cn(
          "relative flex items-center justify-center overflow-hidden rounded-full transition-colors",
          // Static shadow — layered, never animated.
          "shadow-[0_1px_2px_rgba(8,10,30,0.16),0_8px_24px_-8px_rgba(59,130,246,0.35)]",
          variant === "glass"
            ? "bg-white/12 ring-1 ring-white/25 backdrop-blur-xl"
            : "bg-secondary/70 ring-1 ring-border/70 backdrop-blur-sm",
          active && "ring-white/40",
          "group-focus-visible/rp:ring-2 group-focus-visible/rp:ring-blue-400",
        )}
      >
        {/* GLOW — electric blue into royal purple, opacity-animated only. */}
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(circle_at_35%_35%,#3b82f6,transparent_62%),radial-gradient(circle_at_70%_70%,#8b5cf6,transparent_62%)] blur-md transition-opacity duration-300",
            active ? "opacity-70" : "opacity-0 group-hover/rp:opacity-35",
          )}
        />

        {/* RIPPLE — transform+opacity, self-removing. */}
        {ripples.map((id) => (
          <span
            key={id}
            aria-hidden
            onAnimationEnd={() => setRipples((r) => r.filter((x) => x !== id))}
            className="pointer-events-none absolute inset-0 animate-[reel-ripple_460ms_ease-out_forwards] rounded-full bg-white/40 motion-reduce:hidden"
          />
        ))}

        <RepostGlyph
          className={cn(
            "relative transition-colors",
            glyph,
            busy && "animate-pulse",
            active
              ? "text-white drop-shadow-[0_0_6px_rgba(139,92,246,0.9)]"
              : variant === "glass"
                ? "text-white"
                : "text-foreground",
          )}
          strokeWidth={2.1}
        />
      </span>

      {count !== undefined && count > 0 ? (
        <span
          className={cn(
            "text-[11px] font-bold tabular-nums",
            variant === "glass" ? "text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]" : "text-muted-foreground",
          )}
        >
          {count > 999 ? `${(count / 1000).toFixed(count > 9999 ? 0 : 1)}k` : count}
        </span>
      ) : null}
    </motion.button>
  );
}

/**
 * The wide form, for a sheet's primary action.
 *
 * Same glow and spring, laid out as a row so the audience it will reach can be
 * stated ON the button. A repost is public by default and that is the one fact
 * a member most needs before they commit — putting it in the label is cheaper
 * than any amount of explaining afterwards.
 */
export function RepostActionButton({
  onClick,
  label,
  sublabel,
  busy = false,
  disabled = false,
  className,
}: {
  onClick?: () => void;
  label: string;
  sublabel?: string;
  busy?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.button
      type="button"
      onClick={() => {
        if (disabled || busy) return;
        haptic("medium");
        onClick?.();
      }}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      whileTap={reduceMotion || disabled ? undefined : { scale: 0.985 }}
      transition={springs.press}
      className={cn(
        "relative flex w-full items-center justify-center gap-2.5 overflow-hidden rounded-2xl px-4 py-3.5 text-[15px] font-bold text-white outline-none transition disabled:opacity-50",
        "bg-[linear-gradient(100deg,#2563eb,#6d28d9)] shadow-[0_10px_30px_-12px_rgba(79,70,229,0.85)]",
        "focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className,
      )}
    >
      <RepostGlyph className={cn("h-5 w-5", busy && "animate-pulse")} strokeWidth={2.2} />
      <span className="flex flex-col items-start leading-tight">
        <span>{label}</span>
        {sublabel ? <span className="text-[11px] font-medium opacity-80">{sublabel}</span> : null}
      </span>
    </motion.button>
  );
}
