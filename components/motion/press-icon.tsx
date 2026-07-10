"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

import { springs } from "@/lib/motion/springs";

/**
 * Frenz Motion wrapper for interactive glyphs: a physical "press into the
 * surface" compression on tap (slight scale-down + downward nudge, like a
 * real button depressing) that springs back up with a small overshoot pop
 * whenever `active` flips on (a lift, not just a resize — reads as the icon
 * becoming raised/selected rather than merely growing). Respects
 * prefers-reduced-motion by disabling both.
 */
export function PressIcon({
  active = false,
  className,
  children,
}: {
  active?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.span
      // No default `display` here on purpose: an inline style would beat any
      // `hidden`/`sm:*` visibility class a caller passes in `className` (inline
      // styles always win over classes), silently breaking responsive show/hide.
      className={className}
      whileTap={reduceMotion ? undefined : { scale: 0.78, y: 1 }}
      animate={reduceMotion ? undefined : active ? { scale: [1, 1.22, 0.96, 1.04, 1], y: [0, -2, 0, 0, 0] } : { scale: 1, y: 0 }}
      transition={reduceMotion ? { duration: 0 } : springs.bounce}
    >
      {children}
    </motion.span>
  );
}
