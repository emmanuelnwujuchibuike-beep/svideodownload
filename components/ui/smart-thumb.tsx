"use client";

import { type ReactNode, useState } from "react";

import { isImageSeen, markImageSeen } from "@/components/ui/stable-avatar";
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
    /*
      `decoding="async"` alongside the lazy load (2026-08-10).

      They solve different halves. `loading="lazy"` defers the FETCH; decoding
      still happens on the main thread by default, so a screen's worth of
      thumbnails arriving together blocks interaction while each is decoded —
      which on the history page is the jank that reads as "it takes a moment to
      open". `async` lets the browser decode off-thread and paint when ready.

      Safe on a thumbnail specifically: the cost of `async` is that an image may
      appear a frame late, which matters for a hero and does not matter for a
      grid tile that already fades in.
    */
    // eslint-disable-next-line @next/next/no-img-element -- external CDNs; next/image 403s on this project's media hosts
    /*
      🔴 …BUT NOT FOR A TILE ALREADY SEEN (owner, 2026-10-09: "History Medias …
      reloads on every page entry"). Re-entering History remounts every tile;
      lazy + async then made each one wait and decode after first paint, so the
      grid flashed empty on every visit. A thumbnail that has already decoded in
      this tab now renders eager + sync and paints in the frame it mounts.
    */
    <img
      src={src}
      alt={alt}
      loading={isImageSeen(src) ? "eager" : "lazy"}
      decoding={isImageSeen(src) ? "sync" : "async"}
      onLoad={(e) => markImageSeen(src, e.currentTarget)}
      onError={() => setBroken(true)}
      className={className}
    />
  );
}
