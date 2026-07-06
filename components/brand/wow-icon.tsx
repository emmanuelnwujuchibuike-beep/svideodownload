"use client";

import { forwardRef, useId } from "react";

import { cn } from "@/lib/utils";

/**
 * The Frenzsave Wow mark — the platform's signature interaction (replaces the
 * generic like heart). A twin electric spark: custom-drawn, never the emoji.
 * Two stable variants so call sites swap by state:
 *   <WowOutline />          quiet, inherits currentColor like any line icon
 *   <WowSolid />            pressed: electric blue → purple gradient + glow
 * Both are forwardRef components with lucide-compatible props, so they drop
 * into every `icon={...}` slot (action bars, rails, tabs, notification meta).
 */

interface WowProps {
  className?: string;
  strokeWidth?: number | string;
}

// A four-point spark with a small companion spark — reads as "wow" at 16px.
const MAIN = "M11 4C11.85 8.85 15.15 12.15 20 13C15.15 13.85 11.85 17.15 11 22C10.15 17.15 6.85 13.85 2 13C6.85 12.15 10.15 8.85 11 4Z";
const SPARK = "M18.5 2.5C18.8 4.1 19.9 5.2 21.5 5.5C19.9 5.8 18.8 6.9 18.5 8.5C18.2 6.9 17.1 5.8 15.5 5.5C17.1 5.2 18.2 4.1 18.5 2.5Z";

export const WowOutline = forwardRef<SVGSVGElement, WowProps>(function WowOutline({ className, strokeWidth = 2 }, ref) {
  return (
    <svg
      ref={ref}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinejoin="round"
      aria-hidden
      className={cn("shrink-0", className)}
    >
      <path d={MAIN} />
      <path d={SPARK} />
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
      <path d={MAIN} fill={`url(#${id})`} />
      <path d={SPARK} fill={`url(#${id})`} />
    </svg>
  );
});
