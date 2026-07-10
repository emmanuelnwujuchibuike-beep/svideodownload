"use client";

import { animate, useMotionValue } from "framer-motion";
import { useEffect, useRef } from "react";

import { formatCompactNumber } from "@/lib/utils";

/**
 * A count that visibly animates to its new value instead of snapping — the
 * "Animated Like Counter" from the engagement spec, shared by every action
 * bar (feed card, reel rail, image/post viewer rails + desktop sidebars)
 * instead of each hand-rolling its own. Skips the animation on first mount
 * (a card appearing with 42 likes shouldn't count up from 0) and on a huge
 * jump (a defensive snap, not a visible count through unrelated numbers —
 * in practice React's own keying means a different post never reuses this
 * component's state anyway, since each FeedItem's id keys its card).
 * Updates the DOM node directly on each animation frame rather than via
 * React state, so a count-up never costs a re-render.
 */
export function AnimatedCount({ value, className }: { value: number; className?: string }) {
  const spanRef = useRef<HTMLSpanElement | null>(null);
  const mv = useMotionValue(value);
  const prev = useRef(value);
  const mounted = useRef(false);

  useEffect(() => {
    return mv.on("change", (v) => {
      if (spanRef.current) spanRef.current.textContent = formatCompactNumber(Math.round(v));
    });
  }, [mv]);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      prev.current = value;
      mv.set(value);
      return;
    }
    const delta = Math.abs(value - prev.current);
    prev.current = value;
    if (delta === 0) return;
    if (delta > 50) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { duration: 0.5, ease: [0.16, 1, 0.3, 1] });
    return () => controls.stop();
  }, [value, mv]);

  return (
    <span ref={spanRef} className={className}>
      {formatCompactNumber(value)}
    </span>
  );
}
