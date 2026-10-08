"use client";

import { beginCriticalActivity } from "@/lib/pwa/activity-lock";

/**
 * The browser half of a creative upload.
 *
 *   1. read the file LOCALLY (an object URL — nothing is downloaded or
 *      uploaded) for its size, dimensions and length, so a wrong file is
 *      refused before a single byte leaves the phone;
 *   2. for a video, draw one frame into a small WebP poster, so the preview
 *      and later the feed never have to load the video to show something;
 *   3. PUT the file straight to Supabase Storage with progress, holding the
 *      critical-activity lock so a new deploy's reload cannot kill it midway
 *      (the 2026-09-13 "stuck at 58%" lesson).
 *
 * The server never trusts any of these numbers — it re-reads the stored bytes.
 */

export interface LocalMedia {
  mediaType: "image" | "video";
  width: number;
  height: number;
  durationSeconds: number | null;
}

export function mediaTypeOf(file: File): "image" | "video" | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  return null;
}

/** Dimensions and length from the local file. Null when the browser cannot decode it. */
export function readLocalMedia(file: File, timeoutMs = 15_000): Promise<LocalMedia | null> {
  const kind = mediaTypeOf(file);
  if (!kind) return Promise.resolve(null);
  const url = URL.createObjectURL(file);
  return new Promise<LocalMedia | null>((resolve) => {
    let done = false;
    const finish = (v: LocalMedia | null) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      resolve(v);
    };
    setTimeout(() => finish(null), timeoutMs);
    if (kind === "image") {
      const img = new Image();
      img.onload = () => finish({ mediaType: "image", width: img.naturalWidth, height: img.naturalHeight, durationSeconds: null });
      img.onerror = () => finish(null);
      img.src = url;
    } else {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.muted = true;
      v.onloadedmetadata = () =>
        finish({ mediaType: "video", width: v.videoWidth, height: v.videoHeight, durationSeconds: Number.isFinite(v.duration) ? v.duration : null });
      v.onerror = () => finish(null);
      v.src = url;
    }
  });
}

/** One frame of a local video as a small WebP (PNG where WebP encoding is missing). */
export function posterFromVideo(file: File, maxWidth = 640): Promise<Blob | null> {
  const url = URL.createObjectURL(file);
  return new Promise<Blob | null>((resolve) => {
    let done = false;
    const finish = (b: Blob | null) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      resolve(b);
    };
    setTimeout(() => finish(null), 15_000);
    const v = document.createElement("video");
    v.preload = "auto";
    v.muted = true;
    v.playsInline = true;
    v.onloadedmetadata = () => {
      v.currentTime = Math.min(0.5, (Number.isFinite(v.duration) ? v.duration : 1) / 2);
    };
    v.onseeked = () => {
      const scale = Math.min(1, maxWidth / Math.max(1, v.videoWidth));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(v.videoWidth * scale));
      c.height = Math.max(1, Math.round(v.videoHeight * scale));
      const ctx = c.getContext("2d");
      if (!ctx) return finish(null);
      ctx.drawImage(v, 0, 0, c.width, c.height);
      c.toBlob((b) => finish(b), "image/webp", 0.75);
    };
    v.onerror = () => finish(null);
    v.src = url;
  });
}

/** PUT to a signed upload URL with progress. Resolves true only on a 2xx. */
export function putWithProgress(opts: { url: string; body: Blob; contentType: string; onProgress?: (fraction: number) => void; signal?: AbortSignal }): Promise<boolean> {
  const end = beginCriticalActivity();
  return new Promise<boolean>((resolve) => {
    const settle = (ok: boolean) => {
      end();
      resolve(ok);
    };
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", opts.url, true);
    xhr.setRequestHeader("content-type", opts.contentType);
    xhr.setRequestHeader("x-upsert", "true");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) opts.onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => settle(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => settle(false);
    xhr.onabort = () => settle(false);
    opts.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    try {
      xhr.send(opts.body);
    } catch {
      settle(false);
    }
  });
}
