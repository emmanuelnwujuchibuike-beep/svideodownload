"use client";

import { useEffect } from "react";

import { attachHls, supportsNativeHls } from "@/lib/media/hls";

/**
 * Feed a `<video>` element the best available source and manage its lifecycle:
 *  - Cloudflare Stream HLS (adaptive bitrate) when a `hlsUrl` is available — played
 *    natively on Safari/iOS, via hls.js elsewhere (dynamically imported).
 *  - Plain MP4 (`src`) otherwise, or as an automatic fallback if the Stream video
 *    isn't ready / HLS fails — so playback is never worse than today.
 * On teardown it fully releases the decoder + buffers (stable memory over a long
 * reels session). Gate work with `active` (e.g. only when the reel is on/near screen).
 */
export function useAdaptiveSource(
  videoRef: { current: HTMLVideoElement | null },
  {
    hlsUrl,
    src,
    poster,
    active = true,
    onReady,
  }: {
    hlsUrl?: string | null;
    src?: string | null;
    poster?: string | null;
    active?: boolean;
    onReady?: () => void;
  },
) {
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !active) return;

    let destroyed = false;
    let destroyHls: (() => void) | null = null;

    // Plain MP4. #t seeks to a frame when there's no poster so it isn't black
    // before play (matches the profile grid / prior behaviour). Signals ready
    // immediately — setting `src` is enough for the caller to call play().
    const setNative = () => {
      if (!src) return;
      const next = poster ? src : `${src}#t=0.1`;
      if (video.src !== next) video.src = next;
      onReady?.();
    };

    if (hlsUrl) {
      if (supportsNativeHls(video)) {
        if (video.src !== hlsUrl) video.src = hlsUrl; // native ABR (Safari/iOS)
        onReady?.();
      } else {
        void attachHls(video, hlsUrl, {
          onReady,
          onFatal: () => {
            if (!destroyed) setNative(); // Stream not ready / decode error → MP4
          },
        }).then((d) => {
          if (destroyed) d();
          else destroyHls = d;
        });
      }
    } else {
      setNative();
    }

    return () => {
      destroyed = true;
      if (destroyHls) destroyHls();
      // Release the decoder + buffers.
      try {
        video.removeAttribute("src");
        video.load();
      } catch {
        /* element already torn down */
      }
    };
  }, [videoRef, hlsUrl, src, poster, active, onReady]);
}
