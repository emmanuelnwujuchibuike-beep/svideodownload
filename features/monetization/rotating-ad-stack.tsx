"use client";

import { Children, useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * ONE slot that ROTATES between several network units, instead of stacking them
 * (owner, 2026-10-09: "remove the two stacking ad slots close to the wallpaper
 * button and in the history between periods. They are not supposed to stack,
 * rather they should rotate").
 *
 * Every unit stays MOUNTED, so each network loads its ad exactly once. Nothing is
 * ever re-requested or refreshed, which networks like AdSense forbid. Only one is
 * visible: the others are laid out but invisible and taken out of the flow. Every
 * `seconds` the slot moves to the next unit that actually filled (an empty unit
 * collapses to 0 px, so it is skipped). It pauses while the tab is hidden.
 */
const FILLED_PX = 8;

export function RotatingAdStack({ children, seconds = 20, className }: { children: ReactNode; seconds?: number; className?: string }) {
  const items = Children.toArray(children);
  const boxes = useRef<(HTMLDivElement | null)[]>([]);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const filled = (i: number) => (boxes.current[i]?.scrollHeight ?? 0) > FILLED_PX;
    const firstFilledFrom = (from: number): number | null => {
      for (let k = 0; k < items.length; k++) {
        const i = (from + k) % items.length;
        if (filled(i)) return i;
      }
      return null;
    };
    // settle on a unit that filled as the networks answer
    const settle = () => setCurrent((c) => (filled(c) ? c : (firstFilledFrom(c) ?? c)));
    const probes = [600, 2000, 5000, 9000].map((ms) => window.setTimeout(settle, ms));
    const tick = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      setCurrent((c) => firstFilledFrom(c + 1) ?? c);
    }, Math.max(5, seconds) * 1000);
    return () => {
      probes.forEach((t) => window.clearTimeout(t));
      window.clearInterval(tick);
    };
  }, [items.length, seconds]);

  if (items.length <= 1) return <>{children}</>;
  return (
    <div className={cn("relative", className)} data-ad-rotation={items.length}>
      {items.map((child, i) => (
        <div
          key={i}
          ref={(el) => {
            boxes.current[i] = el;
          }}
          aria-hidden={i !== current || undefined}
          className={i === current ? "relative" : "pointer-events-none invisible absolute inset-x-0 top-0"}
        >
          {child}
        </div>
      ))}
    </div>
  );
}
