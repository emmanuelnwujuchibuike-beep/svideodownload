"use client";

import { useEffect, useState } from "react";

import { FrenzLogo } from "@/components/brand/frenz-logo";
import { cn } from "@/lib/utils";

/**
 * Premium branded skeleton loader — a large Frenz "F" with a soft brand aura and
 * a shimmer sweep (tango/X style, NO spinner). Because surfaces are aggressively
 * cached, it waits `delayMs` before showing so a fast load never flashes it.
 * Used where a whole surface is loading (e.g. the full-screen reels page).
 */
export function BrandLoader({
  size = 60,
  delayMs = 400,
  label,
  overlay = true,
  className,
}: {
  size?: number;
  delayMs?: number;
  label?: string;
  overlay?: boolean;
  className?: string;
}) {
  const [show, setShow] = useState(delayMs === 0);
  useEffect(() => {
    if (delayMs === 0) return;
    const t = setTimeout(() => setShow(true), delayMs);
    return () => clearTimeout(t);
  }, [delayMs]);
  if (!show) return null;

  const inner = (
    <div className={cn("flex flex-col items-center justify-center gap-4", className)}>
      <span className="relative flex items-center justify-center">
        {/* Soft brand aura — electric blue → royal purple, gently breathing */}
        <span className="absolute h-28 w-28 rounded-full bg-gradient-to-br from-primary/30 to-accent/30 blur-2xl motion-safe:animate-pulse" />
        {/* The F with a skeleton shimmer sweep over it */}
        <span className="shimmer relative overflow-hidden rounded-[26%] p-1.5">
          <span className="block motion-safe:animate-pulse">
            <FrenzLogo size={size} />
          </span>
        </span>
      </span>
      {label ? <span className="text-gradient text-sm font-bold tracking-tight">{label}</span> : null}
    </div>
  );

  if (!overlay) return inner;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-md" aria-hidden>
      {inner}
    </div>
  );
}
