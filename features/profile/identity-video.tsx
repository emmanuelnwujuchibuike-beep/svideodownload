"use client";

import { useEffect, useRef, useState } from "react";

import { getMedia, saveMedia } from "@/features/downloads/local-media";
import { getSyncConditions } from "@/lib/media/network-conditions";
import { cn } from "@/lib/utils";

/**
 * Profile video that STAYS CONSTANT and plays instantly on repeat visits (owner:
 * "it loads every time … I want it to stay constant like the profile image").
 *
 * The plain `<video src>` re-buffered from the network on every page entry. This
 * caches the clip in IndexedDB (the same store the download library uses), keyed by
 * its URL, so:
 *  - the photo poster shows IMMEDIATELY (no blank/loading frame), then
 *  - a cached copy plays instantly with no network hit; the first visit plays
 *    progressively from the network and caches in the background for next time.
 * Cross-visitor too — a creator's video is cached in each viewer's browser after
 * the first watch. Reduced-motion hides the video and keeps the poster (CSS).
 */
const keyFor = (src: string) => `profile-video|${src}`;

export function IdentityVideo({ src, poster, className }: { src: string; poster: string | null; className?: string }) {
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const objectUrl = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const applyBlob = (blob: Blob) => {
      const u = URL.createObjectURL(blob);
      objectUrl.current = u;
      if (!cancelled) setVideoSrc(u);
    };

    (async () => {
      // 1) Instant path — a cached copy plays with zero network + zero buffering.
      const cached = await getMedia(keyFor(src));
      if (cancelled) return;
      if (cached) {
        applyBlob(cached);
        return;
      }

      /*
        2) First visit — ONE download (2026-10-06, measured on production).

        This used to start the <video> streaming the file AND fetch the same
        file again in the background to cache it: every first view downloaded
        the clip twice (a 2.3 MB intro: one 200 + one 206). Now the file is
        fetched once, cached, and played from that copy; the poster covers the
        wait, as it already did for the buffer. A slow or data-saving
        connection streams without caching, as before.
      */
      const { saveData, effectiveType } = getSyncConditions();
      if (saveData || effectiveType === "slow-2g" || effectiveType === "2g") {
        setVideoSrc(src);
        return;
      }
      try {
        const res = await fetch(src);
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (cancelled) return;
        applyBlob(blob);
        void saveMedia(keyFor(src), blob).catch(() => {});
      } catch {
        /* CORS/offline — stream it directly; no cache this time */
        if (!cancelled) setVideoSrc(src);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl.current) {
        URL.revokeObjectURL(objectUrl.current);
        objectUrl.current = null;
      }
    };
  }, [src]);

  return (
    <span className={cn("relative block overflow-hidden rounded-full", className)}>
      {/* Poster shows instantly, always — never a blank frame while the video loads. */}
      {poster ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={poster} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : null}
      {videoSrc ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video
          src={videoSrc}
          poster={poster ?? undefined}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          onCanPlay={() => setReady(true)}
          className={cn(
            "relative h-full w-full object-cover transition-opacity duration-300 motion-reduce:hidden",
            ready ? "opacity-100" : "opacity-0",
          )}
        />
      ) : null}
    </span>
  );
}
