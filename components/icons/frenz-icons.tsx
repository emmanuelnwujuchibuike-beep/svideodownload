"use client";

import { forwardRef } from "react";

import { cn } from "@/lib/utils";

/**
 * Frenz Signature Icon System — proprietary nav glyphs built from a
 * consistent geometric language (rounded rects + circles, 1.75px stroke,
 * 24x24 optical grid) rather than a third-party icon pack. Each concept
 * ships as an Outline (inactive) + Solid (active) pair, matching the
 * existing outline/filled convention used across the app's nav.
 *
 * Rolled out incrementally — starts on the primary nav (mobile bottom bar +
 * sidebar Home/Friends), the two destinations that appear in both surfaces.
 */

interface IconProps {
  className?: string;
  strokeWidth?: number | string;
}

const base = "shrink-0";

export const FrenzHomeOutline = forwardRef<SVGSVGElement, IconProps>(function FrenzHomeOutline(
  { className, strokeWidth = 1.75 },
  ref,
) {
  return (
    <svg
      ref={ref}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn(base, className)}
    >
      <path d="M4.5 11.75 12 5.25 19.5 11.75" />
      <rect x="6.25" y="11.25" width="11.5" height="8.25" rx="1.75" />
      <path d="M10.1 19.5 V16 a1.9 1.9 0 0 1 3.8 0 v3.5" />
    </svg>
  );
});

export const FrenzHomeSolid = forwardRef<SVGSVGElement, IconProps>(function FrenzHomeSolid(
  { className },
  ref,
) {
  return (
    <svg ref={ref} viewBox="0 0 24 24" fill="currentColor" aria-hidden className={cn(base, className)}>
      <path d="M12 4.6 20.2 11.9H3.8Z" />
      <rect x="6.25" y="11.9" width="3" height="7.6" rx="1.2" />
      <rect x="14.75" y="11.9" width="3" height="7.6" rx="1.2" />
      <rect x="6.25" y="11.9" width="11.5" height="3.2" rx="1.2" />
    </svg>
  );
});

export const FrenzFriendsOutline = forwardRef<SVGSVGElement, IconProps>(function FrenzFriendsOutline(
  { className, strokeWidth = 1.75 },
  ref,
) {
  return (
    <svg
      ref={ref}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn(base, className)}
    >
      <circle cx="8.3" cy="8.3" r="2.2" />
      <path d="M4 19.5a4.3 4.6 0 0 1 8.6 0" />
      <circle cx="15.7" cy="8.3" r="2.2" />
      <path d="M11.4 19.7a4.3 4.6 0 0 1 8.6 0" />
    </svg>
  );
});

export const FrenzFriendsSolid = forwardRef<SVGSVGElement, IconProps>(function FrenzFriendsSolid(
  { className },
  ref,
) {
  return (
    <svg ref={ref} viewBox="0 0 24 24" fill="currentColor" aria-hidden className={cn(base, className)}>
      <circle cx="8.3" cy="8.3" r="2.2" />
      <rect x="4" y="12.6" width="8.6" height="7.6" rx="4.3" />
      <circle cx="15.7" cy="8.3" r="2.2" />
      <rect x="11.4" y="12.8" width="8.6" height="7.6" rx="4.3" />
    </svg>
  );
});

export const FrenzInboxOutline = forwardRef<SVGSVGElement, IconProps>(function FrenzInboxOutline(
  { className, strokeWidth = 1.75 },
  ref,
) {
  return (
    <svg
      ref={ref}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn(base, className)}
    >
      <rect x="4" y="5.5" width="16" height="11" rx="5" />
      <path d="M9.5 16.3 7.8 20.2 12.6 16.5" />
    </svg>
  );
});

export const FrenzInboxSolid = forwardRef<SVGSVGElement, IconProps>(function FrenzInboxSolid(
  { className },
  ref,
) {
  return (
    <svg ref={ref} viewBox="0 0 24 24" fill="currentColor" aria-hidden className={cn(base, className)}>
      <rect x="4" y="5.5" width="16" height="11" rx="5" />
      <path d="M9 16.5 7.5 20.5 13 16.5Z" />
    </svg>
  );
});

export const FrenzPersonSolid = forwardRef<SVGSVGElement, IconProps>(function FrenzPersonSolid(
  { className },
  ref,
) {
  return (
    <svg ref={ref} viewBox="0 0 24 24" fill="currentColor" aria-hidden className={cn(base, className)}>
      <circle cx="12" cy="9" r="3.4" />
      <rect x="5.5" y="14.6" width="13" height="8.4" rx="6.5" />
    </svg>
  );
});
