"use client";

import { forwardRef, useId } from "react";

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

/** Personalization glyph ("For You") — a 4-point sparkle/twinkle, straight-line polygon. */
export const FrenzSparkleOutline = forwardRef<SVGSVGElement, IconProps>(function FrenzSparkleOutline(
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
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden
      className={cn(base, className)}
    >
      <path d="M12 3 13.6 10.4 21 12 13.6 13.6 12 21 10.4 13.6 3 12 10.4 10.4 Z" />
    </svg>
  );
});

export const FrenzSparkleSolid = forwardRef<SVGSVGElement, IconProps>(function FrenzSparkleSolid(
  { className },
  ref,
) {
  return (
    <svg ref={ref} viewBox="0 0 24 24" fill="currentColor" aria-hidden className={cn(base, className)}>
      <path d="M12 3 13.6 10.4 21 12 13.6 13.6 12 21 10.4 13.6 3 12 10.4 10.4 Z" />
    </svg>
  );
});

/** A portrait reel frame with a play notch — "Reels". */
export const FrenzReelsOutline = forwardRef<SVGSVGElement, IconProps>(function FrenzReelsOutline(
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
      <rect x="6.5" y="3.25" width="11" height="17.5" rx="3.25" />
      <path d="M10.2 9.2 15.2 12 10.2 14.8 Z" />
    </svg>
  );
});

export const FrenzReelsSolid = forwardRef<SVGSVGElement, IconProps>(function FrenzReelsSolid(
  { className },
  ref,
) {
  // The play notch is a genuine cut-out (not an overlaid same-color shape,
  // which would just vanish) — a same-shape mask punches the triangle out of
  // the solid frame. `useId` keeps the mask id collision-free if this icon
  // ever renders more than once on the same page.
  const id = useId();
  const maskId = `frenz-reels-mask-${id}`;
  return (
    <svg ref={ref} viewBox="0 0 24 24" fill="currentColor" aria-hidden className={cn(base, className)}>
      <mask id={maskId}>
        <rect x="6.5" y="3.25" width="11" height="17.5" rx="3.25" fill="#fff" />
        <path d="M10.2 9.2 15.2 12 10.2 14.8 Z" fill="#000" />
      </mask>
      <rect x="6.5" y="3.25" width="11" height="17.5" rx="3.25" mask={`url(#${maskId})`} />
    </svg>
  );
});

/*
  Feed (owner, 2026-10-09: "a more icon for the feed button that really explains
  it for news feed and videos"): a post card whose media area carries a play
  button, above two lines of text — a news feed that holds videos.
*/
export const FrenzFeedOutline = forwardRef<SVGSVGElement, IconProps>(function FrenzFeedOutline(
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
      <rect x="3.75" y="3.5" width="16.5" height="17" rx="3.5" />
      <path d="M3.75 13.25h16.5" />
      <path d="M10.6 6.6 14.2 8.45 10.6 10.3Z" />
      <path d="M7.25 16.6h9.5" />
    </svg>
  );
});

export const FrenzFeedSolid = forwardRef<SVGSVGElement, IconProps>(function FrenzFeedSolid({ className }, ref) {
  // one even-odd path: the card, with the play button, the media rule and a text line cut out
  return (
    <svg ref={ref} viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" aria-hidden className={cn(base, className)}>
      <path d="M7 2.75h10a4 4 0 0 1 4 4v10.5a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V6.75a4 4 0 0 1 4-4ZM10.4 6.2v4.5l4.3-2.25ZM3 12.6V14h18v-1.4ZM7.75 15.9a.75.75 0 0 0 0 1.5h8.5a.75.75 0 0 0 0-1.5Z" />
    </svg>
  );
});

/* Earn (owner, 2026-10-09: "the earn button at the bottom nav must use same icon style, size and everything like others"): a coin with the Frenz sparkle. */
export const FrenzEarnOutline = forwardRef<SVGSVGElement, IconProps>(function FrenzEarnOutline(
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
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.6c.45 2.3 1.65 3.5 3.95 3.95-2.3.45-3.5 1.65-3.95 3.95-.45-2.3-1.65-3.5-3.95-3.95 2.3-.45 3.5-1.65 3.95-3.95Z" />
    </svg>
  );
});

export const FrenzEarnSolid = forwardRef<SVGSVGElement, IconProps>(function FrenzEarnSolid({ className }, ref) {
  // one even-odd path: the coin with the sparkle cut out
  return (
    <svg ref={ref} viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" aria-hidden className={cn(base, className)}>
      <path d="M12 2.75a9.25 9.25 0 1 1 0 18.5 9.25 9.25 0 0 1 0-18.5ZM12 7.3c-.5 2.5-1.8 3.8-4.3 4.3 2.5.5 3.8 1.8 4.3 4.3.5-2.5 1.8-3.8 4.3-4.3-2.5-.5-3.8-1.8-4.3-4.3Z" />
    </svg>
  );
});
