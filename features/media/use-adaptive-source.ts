"use client";

import { useEffect } from "react";

import { attachHls, supportsNativeHls } from "@/lib/media/hls";
import { type PlaybackMode, reportPlayback } from "@/lib/media/playback-metrics";

// Sample ~1 in 6 playbacks for metrics — representative signal, low beacon volume.
const METRICS_SAMPLE = 0.16;

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
    postId,
  }: {
    hlsUrl?: string | null;
    src?: string | null;
    poster?: string | null;
    active?: boolean;
    onReady?: () => void;
    /** For playback observability (time-to-first-frame / rebuffers), sampled. */
    postId?: string;
  },
) {
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !active) return;

    let destroyed = false;
    let destroyHls: (() => void) | null = null;

    // ── Observability (sampled): time-to-first-frame + rebuffer count ──────────
    const sampled = Math.random() < METRICS_SAMPLE;
    const t0 = performance.now();
    let mode: PlaybackMode = "mp4";
    let firstFrame = false;
    let ttffMs: number | undefined;
    let rebuffers = 0;
    const onPlaying = () => {
      if (!firstFrame) {
        firstFrame = true;
        ttffMs = Math.round(performance.now() - t0);
      }
    };
    const onWaiting = () => {
      if (firstFrame) rebuffers += 1;
    };
    if (sampled) {
      video.addEventListener("playing", onPlaying);
      video.addEventListener("waiting", onWaiting);
    }

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
        mode = "native-hls";
        if (video.src !== hlsUrl) video.src = hlsUrl; // native ABR (Safari/iOS)
        onReady?.();
      } else {
        mode = "hls";
        void attachHls(video, hlsUrl, {
          onReady,
          onFatal: () => {
            if (!destroyed) {
              mode = "mp4";
              setNative(); // Stream not ready / decode error → MP4
            }
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
      if (sampled) {
        video.removeEventListener("playing", onPlaying);
        video.removeEventListener("waiting", onWaiting);
        if (firstFrame) reportPlayback({ postId, mode, ttffMs, rebuffers });
      }
      if (destroyHls) destroyHls();
      // Release the decoder + buffers.
      try {
        video.removeAttribute("src");
        video.load();
      } catch {
        /* element already torn down */
      }
    };
  }, [videoRef, hlsUrl, src, poster, active, onReady, postId]);
}
