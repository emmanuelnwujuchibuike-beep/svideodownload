"use client";

import type { VideoMetadata } from "@/lib/ai/character-replace/types";
import { aspectRatioOf, containerOf, resolutionLabelOf, toMs } from "@/lib/ai/character-replace/validate";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  READING A PICKED FILE — the browser's own decoders, once
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Part 2, §6: "detect as much metadata as safely possible on the client
 * without introducing an unnecessarily large dependency." And §18: "Do not
 * process the entire video in the browser just to display metadata. Do not
 * repeatedly decode the video."
 *
 * So: one `<img>` for the photo, one throw-away `<video preload="metadata">`
 * for the video. `loadedmetadata` fires once the container header is read —
 * a few hundred kilobytes of a 60 MB file, not the file — and reports the
 * duration and the frame size. The element is then released so the preview
 * player is the only decoder alive.
 *
 * ── What can and cannot be read, honestly ──────────────────────────────────
 *
 *   duration, width, height    every engine, at `loadedmetadata`
 *   hasAudio                   Safari (`audioTracks`), Firefox (`mozHasAudio`);
 *                              Chrome only after playback has decoded audio
 *                              (`webkitAudioDecodedByteCount`), which has not
 *                              happened here — so Chrome answers null
 *   frameRate, videoCodec      no engine exposes them without decoding frames
 *                              or parsing the container; null
 *   audioDurationMs            not separately exposed; null
 *
 * A null is "not known", and the server's ffprobe fills it in. Nothing here
 * guesses.
 */

/** The photo's pixel size, or null when the browser cannot decode it. */
export function readImageSize(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const done = (value: { width: number; height: number } | null) => {
      img.onload = null;
      img.onerror = null;
      resolve(value);
    };
    img.onload = () => done(img.naturalWidth > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : null);
    img.onerror = () => done(null);
    img.src = url;
  });
}

/** Browser-specific audio-track fields, typed rather than cast at the call site. */
interface VideoWithTracks extends HTMLVideoElement {
  audioTracks?: { length: number };
  mozHasAudio?: boolean;
  webkitAudioDecodedByteCount?: number;
}

/**
 * The video's facts, or "invalid" when the browser cannot open the file at
 * all. A container that hides its metadata answers with nulls after a
 * bounded wait rather than hanging the picker — "unmeasured" and "invalid"
 * are different claims, and the interface says which.
 */
export function readVideoMetadata(url: string, file: { name: string; size: number; type: string }): Promise<VideoMetadata | "invalid"> {
  return new Promise((resolve) => {
    const video = document.createElement("video") as VideoWithTracks;
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    let settled = false;

    const finish = (value: VideoMetadata | "invalid") => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onerror = null;
      // Let go of the decoder: the preview element makes its own.
      video.removeAttribute("src");
      video.load();
      resolve(value);
    };

    const base = (): VideoMetadata => ({
      durationMs: null,
      width: null,
      height: null,
      aspect: null,
      resolutionLabel: null,
      sizeBytes: file.size,
      mimeType: file.type,
      container: containerOf(file.name, file.type),
      frameRate: null,
      videoCodec: null,
      hasAudio: null,
      audioDurationMs: null,
    });

    // A header that never arrives: a truncated download, a container the
    // engine will not parse. Eight seconds is generous for metadata.
    const timer = window.setTimeout(() => finish(base()), 8_000);

    video.onloadedmetadata = () => {
      const width = video.videoWidth > 0 ? video.videoWidth : null;
      const height = video.videoHeight > 0 ? video.videoHeight : null;
      const hasAudio =
        typeof video.audioTracks?.length === "number"
          ? video.audioTracks.length > 0
          : typeof video.mozHasAudio === "boolean"
            ? video.mozHasAudio
            : // Chrome: only positive evidence counts. Zero bytes decoded means
              // "nothing played yet", not "silent".
              typeof video.webkitAudioDecodedByteCount === "number" && video.webkitAudioDecodedByteCount > 0
              ? true
              : null;
      finish({
        ...base(),
        durationMs: toMs(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null),
        width,
        height,
        aspect: aspectRatioOf(width, height),
        resolutionLabel: resolutionLabelOf(width, height),
        hasAudio,
      });
    };
    video.onerror = () => finish("invalid");
    video.src = url;
  });
}

/**
 * The replacement audio's length, as the browser decodes it (Part 6 §3), or
 * "invalid" when it cannot open the file. Integer milliseconds, null when the
 * container hides its duration — the worker's ffprobe is the authority
 * either way, and the fit decision is the server's (§4); this only lets the
 * interface say "your audio is longer than the selected video" BEFORE an
 * upload. One `<audio>` element, released on every outcome.
 */
export function readAudioDuration(url: string): Promise<number | null | "invalid"> {
  return new Promise((resolve) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    let settled = false;
    const done = (value: number | null | "invalid") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      audio.onloadedmetadata = null;
      audio.onerror = null;
      audio.removeAttribute("src");
      try {
        audio.load();
      } catch {
        /* nothing to release */
      }
      resolve(value);
    };
    const timer = window.setTimeout(() => done(null), 8_000);
    audio.onloadedmetadata = () => {
      const d = audio.duration;
      done(Number.isFinite(d) && d > 0 ? Math.round(d * 1000) : null);
    };
    audio.onerror = () => done("invalid");
    audio.src = url;
  });
}
