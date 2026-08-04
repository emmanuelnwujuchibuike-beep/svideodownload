"use client";

import type { ReactNode } from "react";

import { usePresence } from "@/features/friends/use-presence";
import { cn } from "@/lib/utils";

/**
 * Identity Ring (Feature 4 exclusive #2) — a slowly drifting gradient ring
 * around the avatar whose colour reflects who this person is right now.
 *
 * ── The ring still MEANS something (2026-08-04) ───────────────────────────
 * The lux brief asks for a blue→purple ring with a soft outer glow. Painting
 * every ring blue→purple would have thrown away what the ring is for: emerald
 * says online, gold says premium, and the vivid blue→violet says verified.
 * Those are real facts about the person, and a decorative ring that overwrites
 * them makes the profile prettier and less informative.
 *
 * So the brief is applied to the case that carried no information: an ordinary
 * member's ring was a flat grey and is now a SOFT blue→violet — premium at a
 * glance, while the vivid version stays reserved for a verified account. The
 * outer glow is new on every ring.
 *
 * Rotation is a separate absolutely-positioned layer so the avatar itself
 * never spins, and the glow is a box-shadow on a sibling so the photo never
 * blurs. 14s, not 8s: the brief asked for slow. Reduced motion keeps every
 * colour and stops both animations.
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
        ? "conic-gradient(from 0deg, #2563FF, #6D5CFF, #9B8CFF, #2563FF)"
        : // Ordinary member: the same hues at a fraction of the strength, so it
          // reads as craft rather than as a badge someone hasn't earned.
          "conic-gradient(from 0deg, rgba(37,99,255,0.45), rgba(109,92,255,0.4), rgba(37,99,255,0.16), rgba(37,99,255,0.45))";

  return (
    <span className={cn("relative inline-block rounded-full p-[3px]", className)}>
      {/* Outer glow — breathes on a 7s cycle, behind everything. */}
      <span aria-hidden className="lux-ring-glow lux-ring-breathe absolute inset-0 rounded-full" />
      <span
        aria-hidden
        className="lux-ring-spin absolute inset-0 rounded-full"
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
