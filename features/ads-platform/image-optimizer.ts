"use client";

import { probeMedia } from "@/lib/ads-platform/media-probe";
import { fitWithin, MAX_DECODE_PIXELS } from "@/lib/ads-platform/media-spec";

/**
 * Optimize an ad image in the advertiser's browser before it is uploaded (0208).
 *
 * 1. The header is read WITHOUT decoding (the same probe the server uses), so a
 *    file that claims an absurd pixel count is refused before it can allocate
 *    gigabytes — the decompression-bomb guard.
 * 2. The resize runs in a Web Worker (optimize-image.worker.ts) so the page
 *    stays responsive; where workers or OffscreenCanvas are missing, the same
 *    steps run on the main thread on one canvas.
 *
 * The server still checks the real uploaded bytes — nothing here is trusted.
 */

export type Optimized = { blob: Blob; width: number; height: number; mime: string } | { error: "decode_too_large" | "optimize_failed" | "not_recognised" };

/** Display dimensions from the file header, without decoding the pixels. */
export async function headerDimensions(file: File): Promise<{ width: number; height: number } | null> {
  const read = async (offset: number, length: number) => new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
  const facts = await probeMedia(read, file.size).catch(() => null);
  return facts?.width && facts.height ? { width: facts.width, height: facts.height } : null;
}

export async function optimizeImage(file: File, longEdge: number, quality: number): Promise<Optimized> {
  const dims = await headerDimensions(file);
  if (!dims) return { error: "not_recognised" };
  if (dims.width * dims.height > MAX_DECODE_PIXELS) return { error: "decode_too_large" };

  const viaWorker = typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined";
  if (viaWorker) {
    try {
      const out = await new Promise<{ ok: boolean; blob?: Blob; width?: number; height?: number }>((resolve) => {
        const w = new Worker(new URL("./optimize-image.worker.ts", import.meta.url));
        const timer = setTimeout(() => {
          w.terminate();
          resolve({ ok: false });
        }, 60_000);
        w.onmessage = (e) => {
          clearTimeout(timer);
          w.terminate();
          resolve(e.data);
        };
        w.onerror = () => {
          clearTimeout(timer);
          w.terminate();
          resolve({ ok: false });
        };
        w.postMessage({ blob: file, longEdge, quality });
      });
      if (out.ok && out.blob && out.width && out.height) return { blob: out.blob, width: out.width, height: out.height, mime: out.blob.type || "image/webp" };
    } catch {
      /* fall through to the main thread */
    }
  }

  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const t = fitWithin(bmp.width, bmp.height, longEdge);
    const c = document.createElement("canvas");
    c.width = t.width;
    c.height = t.height;
    const ctx = c.getContext("2d");
    if (!ctx) return { error: "optimize_failed" };
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, 0, 0, t.width, t.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/webp", Math.min(1, Math.max(0.4, quality / 100))));
    if (!blob) return { error: "optimize_failed" };
    return { blob, width: t.width, height: t.height, mime: blob.type || "image/webp" };
  } catch {
    return { error: "optimize_failed" };
  }
}
