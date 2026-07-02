"use client";

import type { ReactNode } from "react";

import { usePresence } from "@/features/friends/use-presence";
import { cn } from "@/lib/utils";

/**
 * Identity Ring (Feature 4 exclusive #2): a slowly rotating gradient ring
 * around the avatar whose color reflects who this person is right now —
 * emerald when online, gold for premium, electric blue→purple for verified,
 * and a quiet neutral otherwise. Rotation is a separate absolutely-positioned
 * layer so the avatar itself never spins; reduced-motion stops the rotation
 * but keeps the color.
 */
export function IdentityRing({
  userId,
  verified = false,
  premium = false,
  className,
  children,
}: {
  userId: string;
  verified?: boolean;
  premium?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const online = usePresence().has(userId);

  const gradient = online
    ? "conic-gradient(from 0deg, #34d399, #2dd4bf, #6ee7b7, #34d399)"
    : premium
      ? "conic-gradient(from 0deg, #f59e0b, #fbbf24, #fde68a, #f59e0b)"
      : verified
        ? "conic-gradient(from 0deg, #3b82f6, #7c3aed, #d946ef, #3b82f6)"
        : "conic-gradient(from 0deg, hsl(var(--border)), hsl(var(--muted-foreground) / 0.35), hsl(var(--border)))";

  return (
    <span className={cn("relative inline-block rounded-full p-[3px]", className)}>
      <span
        aria-hidden
        className="absolute inset-0 rounded-full motion-safe:animate-[spin_8s_linear_infinite]"
        style={{ background: gradient }}
      />
      <span className="relative block rounded-full bg-background p-[3px]">
        {children}
        {online ? (
          <span aria-label="Online" className="absolute bottom-1 right-1 flex h-4 w-4 items-center justify-center">
            <span className="absolute h-full w-full animate-ping rounded-full bg-emerald-400/60 motion-reduce:hidden" />
            <span className="relative h-3 w-3 rounded-full bg-emerald-400 ring-2 ring-background" />
          </span>
        ) : null}
      </span>
    </span>
  );
}
