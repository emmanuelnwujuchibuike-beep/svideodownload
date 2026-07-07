"use client";

import { useEffect } from "react";

import { attachHls, supportsNativeHls, type HlsHandle } from "@/lib/media/hls";
import { getPlaybackConditions, getSyncConditions } from "@/lib/media/network-conditions";
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
    let hlsHandle: HlsHandle | null = null;

    // ── Observability (sampled): TTFF, rebuffers, dropped frames, bitrate, errors ──
    const sampled = Math.random() < METRICS_SAMPLE;
    const t0 = performance.now();
    let mode: PlaybackMode = "mp4";
    let firstFrame = false;
    let ttffMs: number | undefined;
    let rebuffers = 0;
    let errored = false;
    const onPlaying = () => {
      if (!firstFrame) {
        firstFrame = true;
        ttffMs = Math.round(performance.now() - t0);
      }
    };
    const onWaiting = () => {
      if (firstFrame) rebuffers += 1;
    };
    const onError = () => {
      errored = true;
    };
    if (sampled) {
      video.addEventListener("playing", onPlaying);
      video.addEventListener("waiting", onWaiting);
      video.addEventListener("error", onError);
    }

    // Never default to the highest rendition — cap by connection/data-saver
    // synchronously (instant playback shouldn't wait on the async Battery API),
    // then refine the cap once a battery reading resolves.
    const initialConditions = getSyncConditions();

    // Plain MP4. #t seeks to a frame when there's no poster so it isn't black
    // before play (matches the profile grid / prior behaviour). Signals ready
    // immediately — setting `src` is enough for the caller to call play().
    const setNative = () => {
      if (!src) return;
      const next = poster ? src : `${src}#t=0.1`;
      if (video.src !== next) video.src = next;
      onReady?.();
    };

    // Native-HLS (iOS Safari) fallback: hls.js browsers get onFatal → MP4, but
    // Safari's built-in player previously had NO error path — a manifest that
    // isn't ready yet (a just-uploaded reel mid-encode) hung on a spinner until
    // the user left and came back. Any media error now swaps to the MP4 source.
    let nativeErrorHandler: (() => void) | null = null;

    if (hlsUrl) {
      if (supportsNativeHls(video)) {
        // Safari's native HLS manages its own ABR ladder with no JS-level cap
        // hook — it already avoids over-fetching on a metered connection via
        // its own heuristics, so we don't attempt a height cap here.
        mode = "native-hls";
        if (video.src !== hlsUrl) video.src = hlsUrl;
        if (src) {
          nativeErrorHandler = () => {
            if (destroyed) return;
            mode = "mp4";
            setNative();
            void video.play().catch(() => {});
          };
          video.addEventListener("error", nativeErrorHandler);
        }
        onReady?.();
      } else {
        mode = "hls";
        void attachHls(video, hlsUrl, {
          onReady,
          maxHeight: initialConditions.maxHeight,
          onFatal: () => {
            if (!destroyed) {
              mode = "mp4";
              setNative(); // Stream not ready / decode error → MP4
            }
          },
        }).then((handle) => {
          if (destroyed) {
            handle.destroy();
            return;
          }
          hlsHandle = handle;
          // Refine the cap once the (async) battery reading resolves — e.g. drop
          // to 720p if the device just entered low-battery unplugged mode.
          void getPlaybackConditions().then((full) => {
            if (!destroyed && full.maxHeight !== initialConditions.maxHeight) {
              hlsHandle?.setMaxHeightCap(full.maxHeight);
            }
          });
        });
      }
    } else {
      setNative();
    }

    return () => {
      destroyed = true;
      if (nativeErrorHandler) video.removeEventListener("error", nativeErrorHandler);
      if (sampled) {
        video.removeEventListener("playing", onPlaying);
        video.removeEventListener("waiting", onWaiting);
        video.removeEventListener("error", onError);
        if (firstFrame || errored) {
          const q = typeof video.getVideoPlaybackQuality === "function" ? video.getVideoPlaybackQuality() : null;
          reportPlayback({
            postId,
            mode,
            ttffMs,
            rebuffers,
            droppedFrames: q?.droppedVideoFrames,
            decodedFrames: q?.totalVideoFrames,
            bitrateKbps: hlsHandle?.getBitrateKbps(),
            errored,
          });
        }
      }
      if (hlsHandle) hlsHandle.destroy();
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
