"use client";

import { type ReactNode, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * A thumbnail <img> that falls back to a branded placeholder (an icon on a soft
 * gradient) when the source is missing OR fails to load — the common case being a
 * source-CDN url (TikTok/Snap/…) that has since expired or 403s, which otherwise
 * shows the browser's default broken-image "?" glyph (owner report, 2026-08-02:
 * "some videos are showing question mark but they still play"). The media itself
 * still plays; only its cover preview is gone, so this just keeps the cover clean.
 *
 * `broken` is reset SYNCHRONOUSLY when `src` changes (not in a post-paint effect)
 * so a recycled tile never renders one stale frame — same pattern as FeedImage.
 */
export function SmartThumb({
  src,
  alt,
  className,
  fallback,
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
  fallback: ReactNode;
}) {
  const [broken, setBroken] = useState(false);
  const [lastSrc, setLastSrc] = useState(src);
  if (src !== lastSrc) {
    setLastSrc(src);
    setBroken(false);
  }

  if (!src || broken) {
    return (
      <div className={cn("flex items-center justify-center bg-gradient-to-br from-slate-700 to-slate-900 text-white/50", className)} aria-label={alt}>
        {fallback}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} loading="lazy" onError={() => setBroken(true)} className={className} />
  );
}
