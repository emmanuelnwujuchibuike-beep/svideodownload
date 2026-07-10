"use client";

import { motion, useReducedMotion } from "framer-motion";

import { springs } from "@/lib/motion/springs";
import { cn } from "@/lib/utils";

/**
 * Premium toggle — a slim, monochrome track (no color, no glow) with a
 * spring-animated thumb. Shared by every Home-module visibility switch and
 * the account Home Modules Editor's feed-behavior rows. Owner correction
 * (2026-07-10): the original was a taller track with a brand-gradient fill +
 * colored glow when on — reported as "too fat and common," i.e. reading like
 * a generic default OS toggle rather than a refined control. Trimmed the
 * track and swapped the fill for the same `bg-foreground`/`bg-background`
 * invert the rest of the nav/icon system now uses (dark track + light thumb
 * in light mode, light track + dark thumb in dark mode) — smaller, flatter,
 * no color at all.
 */
export function Switch({
  checked,
  onChange,
  label,
  className,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200",
        checked ? "bg-foreground" : "bg-secondary ring-1 ring-inset ring-border",
        className,
      )}
    >
      <motion.span
        animate={{ x: checked ? 18 : 2 }}
        transition={reduceMotion ? { duration: 0 } : springs.bounce}
        className={cn("inline-block h-4 w-4 rounded-full shadow-sm", checked ? "bg-background" : "bg-white")}
      />
    </button>
  );
}
