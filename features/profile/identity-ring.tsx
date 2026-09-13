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
 * ── The own header asks for the frame alone (2026-09-13) ─────────────────
 * Owner: "remove the shadow and shadow colour, it should only use gold Frame
 * ring or any color set by the user." Three opt-outs exist for that one
 * caller — `glow`, `presence`, `accent` — and every default keeps a visitor's
 * view exactly as it was. See each prop.
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
  accent = null,
  glow = true,
  presence = true,
  className,
  children,
}: {
  userId: string;
  verified?: boolean;
  premium?: boolean;
  /**
   * The member's own accent colour (Appearance), as a `#rrggbb` string. When
   * set and the member is not on a paid plan, the frame is painted in it —
   * "gold Frame ring or any color set by the user". Gold still wins for a paid
   * plan; the accent replaces the verified blue and the default violet, never
   * the gold.
   */
  accent?: string | null;
  /**
   * The breathing outer glow (`lux-ring-glow`). Off on the member's own profile
   * header, where the owner asked for the frame alone — "remove the shadow and
   * shadow colour". Everywhere else it stays as it was.
   */
  glow?: boolean;
  /**
   * Whether an online member gets the emerald ring and the dot. Off on the own
   * header for the same reason as `glow`: the frame there is gold or the
   * accent, nothing else. A visitor's view is unchanged.
   */
  presence?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const online = usePresence().has(userId) && presence;

  const gradient = online
    ? "conic-gradient(from 0deg, #34d399, #2dd4bf, #6ee7b7, #34d399)"
    : premium
      ? "conic-gradient(from 0deg, #f59e0b, #fbbf24, #fde68a, #f59e0b)"
      : accent
        ? accentFrame(accent)
        : verified
          ? "conic-gradient(from 0deg, #2563FF, #6D5CFF, #9B8CFF, #2563FF)"
          : // Ordinary member: the same hues at a fraction of the strength, so it
            // reads as craft rather than as a badge someone hasn't earned.
            "conic-gradient(from 0deg, rgba(37,99,255,0.45), rgba(109,92,255,0.4), rgba(37,99,255,0.16), rgba(37,99,255,0.45))";

  return (
    <span className={cn("relative inline-block rounded-full p-[3px]", className)}>
      {/* Outer glow — breathes on a 7s cycle, behind everything. Not drawn when
          the caller wants the frame alone. */}
      {glow ? <span aria-hidden className="lux-ring-glow lux-ring-breathe absolute inset-0 rounded-full" /> : null}
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

/**
 * The member's accent as a frame: the colour, a lighter pass of it, and back —
 * the same three-stop shape the gold and blue frames use, so an accent frame
 * spins and reads exactly like the built-in ones. `hex` comes from
 * `accentHex()`, which only ever returns a `#rrggbb` from its own palette, so
 * appending an alpha byte is safe.
 */
function accentFrame(hex: string): string {
  return `conic-gradient(from 0deg, ${hex}, ${hex}cc, ${hex}66, ${hex})`;
}
