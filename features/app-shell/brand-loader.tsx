"use client";

import { useEffect, useState } from "react";

import { FrenzLogo } from "@/components/brand/frenz-logo";
import { cn } from "@/lib/utils";

/**
 * Quiet loading state — a faint, COLORLESS bold "F" with a soft skeleton shimmer
 * (no spinner, no brand color). Almost invisible on purpose: it's a subtle "one
 * moment" hint, never a bold, colorful takeover. The loud, colorful welcome is
 * reserved for the very first uncached /home entry (see BrandSplash).
 *
 * Because surfaces are aggressively cached, it waits `delayMs` before showing so
 * a fast load never flashes it.
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
    <div className={cn("flex flex-col items-center justify-center gap-3", className)} aria-hidden>
      {/* Colorless (grayscale), faint F with a skeleton shimmer sweep — no aura */}
      <span className="shimmer relative overflow-hidden rounded-[26%] p-1">
        <span className="block opacity-25 [filter:grayscale(1)] motion-safe:animate-pulse">
          <FrenzLogo size={size} />
        </span>
      </span>
      {label ? <span className="text-xs font-medium text-muted-foreground/50">{label}</span> : null}
    </div>
  );

  if (!overlay) return inner;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm" aria-hidden>
      {inner}
    </div>
  );
}
