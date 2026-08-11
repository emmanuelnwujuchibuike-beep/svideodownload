"use client";

import { useEffect } from "react";

import { decidePolicy } from "@/lib/media/engine/governor";
import { currentPolicySync, droppedFrameRatio, readSignals } from "@/lib/media/engine/signals";
import { attachHls, supportsNativeHls, type HlsHandle } from "@/lib/media/hls";
import { getQualityPreference, getSyncConditions } from "@/lib/media/network-conditions";
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

    /*
      ── FrenzStream™ governs the whole attach (Feature 15 Part 2) ───────────
      One `decidePolicy` call now decides the ceiling AND the buffer geometry,
      instead of the ceiling coming from `network-conditions` while the buffers
      sat hardcoded in `hls.ts`. Read synchronously — instant playback must never
      wait on the promise-based Battery API — and refined below once a battery
      reading resolves, exactly as the cap alone used to be.
    */
    const initialPolicy = currentPolicySync(getQualityPreference());
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
          maxHeight: initialPolicy.maxHeight,
          buffer: {
            forwardSec: initialPolicy.forwardBufferSec,
            maxForwardSec: initialPolicy.maxForwardBufferSec,
            backSec: initialPolicy.backBufferSec,
            startBitrateEstimate: initialPolicy.startBitrateEstimate,
          },
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
          /*
            Refine once the (async) battery reading resolves — e.g. drop to 720p
            if the device is unplugged and low.

            🔴 Only the CEILING is refined mid-playback, never the buffer
            geometry: hls.js takes its buffer config at construction, and
            rebuilding the instance to change it would tear down the decoder and
            restart the clip. The buffer decision is therefore an attach-time
            one, and the next clip in the deck picks up the new geometry — which
            is a second or two away in a scrolling feed.
          */
          void readSignals(getQualityPreference(), {
            droppedFrameRatio: droppedFrameRatio(video),
          }).then((signals) => {
            if (destroyed) return;
            const refined = decidePolicy(signals);
            if (refined.maxHeight !== initialPolicy.maxHeight) {
              hlsHandle?.setMaxHeightCap(refined.maxHeight);
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
