"use client";

import { forwardRef, useId } from "react";

import { cn } from "@/lib/utils";

/**
 * The Frenzsave Wow mark — the platform's signature interaction (replaces the
 * generic like heart). A wide-eyed, open-mouthed "WOW" face: custom-drawn,
 * never the emoji. Two stable variants so call sites swap by state:
 *   <WowOutline />          quiet, inherits currentColor like any line icon
 *   <WowSolid />            pressed: electric blue → purple gradient + glow
 * Both are forwardRef components with lucide-compatible props, so they drop
 * into every `icon={...}` slot (action bars, rails, tabs, notification meta).
 */

interface WowProps {
  className?: string;
  strokeWidth?: number | string;
}

export const WowOutline = forwardRef<SVGSVGElement, WowProps>(function WowOutline({ className, strokeWidth = 2 }, ref) {
  return (
    <svg
      ref={ref}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      aria-hidden
      className={cn("shrink-0", className)}
    >
      {/* face */}
      <circle cx="12" cy="12" r="9.25" />
      {/* wide astonished eyes */}
      <circle cx="8.5" cy="9.4" r="0.5" fill="currentColor" strokeWidth="1.4" />
      <circle cx="15.5" cy="9.4" r="0.5" fill="currentColor" strokeWidth="1.4" />
      {/* open "wow" mouth */}
      <ellipse cx="12" cy="15" rx="2.4" ry="3.1" />
    </svg>
  );
});

export const WowSolid = forwardRef<SVGSVGElement, WowProps>(function WowSolid({ className }, ref) {
  const id = useId();
  return (
    <svg
      ref={ref}
      viewBox="0 0 24 24"
      aria-hidden
      className={cn("shrink-0", className)}
      style={{ filter: "drop-shadow(0 0 5px rgba(124,58,237,0.55))" }}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#3B82F6" />
          <stop offset="100%" stopColor="#7C3AED" />
        </linearGradient>
      </defs>
      {/* face */}
      <circle cx="12" cy="12" r="10" fill={`url(#${id})`} />
      {/* wide astonished eyes */}
      <circle cx="8.5" cy="9.4" r="1.5" fill="#fff" />
      <circle cx="15.5" cy="9.4" r="1.5" fill="#fff" />
      {/* open "wow" mouth */}
      <ellipse cx="12" cy="15.2" rx="2.6" ry="3.3" fill="#fff" />
    </svg>
  );
});
