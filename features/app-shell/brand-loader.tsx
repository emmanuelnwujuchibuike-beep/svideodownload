"use client";

import { useEffect, useState } from "react";

import { FrenzLogo } from "@/components/brand/frenz-logo";
import { cn } from "@/lib/utils";

/**
 * Branded loader — a pulsing Frenz "F" in a spinning gradient ring. Because
 * surfaces are aggressively cached (revisits are instant), this only appears
 * when a load actually takes a moment: it waits `delayMs` before showing, so a
 * fast cached load never flashes it. Used as a delayed overlay on route loading
 * states and anywhere a longer fetch is in flight.
 */
export function BrandLoader({
  size = "sm",
  delayMs = 500,
  label,
  overlay = true,
  className,
}: {
  size?: "sm" | "md";
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

  const ring = size === "md" ? "h-24 w-24" : "h-16 w-16";
  const mark = size === "md" ? 44 : 30;

  const inner = (
    <div className={cn("flex flex-col items-center justify-center gap-4", className)}>
      <span className={cn("relative flex items-center justify-center", ring)}>
        <span className="absolute inset-0 animate-spin rounded-full border-[3px] border-violet-500/20 border-t-violet-500 [animation-duration:0.8s]" />
        <span className="absolute inset-1.5 animate-spin rounded-full border-[2px] border-blue-500/10 border-b-blue-500 [animation-duration:1.2s] [animation-direction:reverse]" />
        <span className="animate-pulse drop-shadow-[0_2px_12px_rgba(124,58,237,0.45)]">
          <FrenzLogo size={mark} />
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
