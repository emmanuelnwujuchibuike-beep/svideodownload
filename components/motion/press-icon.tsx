"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

import { springs } from "@/lib/motion/springs";

/**
 * Frenz Motion wrapper for interactive glyphs: a spring compression on press
 * and a small overshoot bounce whenever `active` flips on. Respects
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
      whileTap={reduceMotion ? undefined : { scale: 0.8 }}
      animate={reduceMotion ? undefined : active ? { scale: [1, 1.16, 1] } : { scale: 1 }}
      transition={reduceMotion ? { duration: 0 } : springs.bounce}
    >
      {children}
    </motion.span>
  );
}
