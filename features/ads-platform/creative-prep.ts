"use client";

import { imageNeedsOptimizing, MAX_DECODE_PIXELS, type MediaSpec } from "@/lib/ads-platform/media-spec";

import { headerDimensions, optimizeImage } from "./image-optimizer";

/**
 * The two client steps a NEW creative and a REPLACEMENT share (0208), so the
 * application and the dashboard can never treat a file differently:
 *
 *   prepareCreativeFile  header read (no decode), the pixel-bomb guard, and —
 *                        when the image is larger or heavier than served — the
 *                        worker resize to the delivery size, same proportions
 *   waitForProcessing    a video the server handed to Cloudflare Stream: poll the
 *                        status route slowly, for a bounded time, until it is
 *                        ready or has failed
 */

export type Prepared = { ok: true; file: File; optimized: boolean } | { ok: false; code: "not_recognised" | "decode_too_large" | "optimize_failed" };

export async function prepareCreativeFile(file: File, kind: "image" | "video", spec: MediaSpec, onOptimizing?: () => void): Promise<Prepared> {
  if (kind === "video") return { ok: true, file, optimized: false };
  const dims = await headerDimensions(file);
  if (!dims) return { ok: false, code: "not_recognised" };
  if (dims.width * dims.height > MAX_DECODE_PIXELS) return { ok: false, code: "decode_too_large" };
  if (!imageNeedsOptimizing(dims.width, dims.height, file.size, file.type, spec)) return { ok: true, file, optimized: false };
  onOptimizing?.();
  const o = await optimizeImage(file, spec.deliveryLongEdge, spec.imageQuality);
  if ("error" in o) return { ok: false, code: o.error };
  const name = file.name.replace(/\.[^.]+$/, "") + (o.mime === "image/png" ? ".png" : ".webp");
  return { ok: true, file: new File([o.blob], name, { type: o.mime }), optimized: true };
}

export const PROCESSING_WAIT_MS = 20 * 60 * 1000;
export const PROCESSING_POLL_MS = 4000;

export type ProcessingOutcome =
  | { state: "ready"; mediaUrl: string; thumbnailUrl: string | null }
  | { state: "failed"; messages: string[] }
  | { state: "waiting" }
  | { state: "gone" };

export async function waitForProcessing(creativeId: string, alive: () => boolean, wait = PROCESSING_WAIT_MS, every = PROCESSING_POLL_MS): Promise<ProcessingOutcome> {
  const until = Date.now() + wait;
  for (;;) {
    await new Promise((r) => setTimeout(r, every));
    if (!alive()) return { state: "gone" };
    try {
      const res = await fetch("/api/ads/advertiser/upload/status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ creativeId }) });
      const j = (await res.json().catch(() => null)) as { state?: string; mediaUrl?: string | null; thumbnailUrl?: string | null; messages?: string[] } | null;
      if (j?.state === "ready" && j.mediaUrl) return { state: "ready", mediaUrl: j.mediaUrl, thumbnailUrl: j.thumbnailUrl ?? null };
      if (j?.state === "failed") return { state: "failed", messages: j.messages ?? [] };
    } catch {
      /* offline for a moment: keep waiting */
    }
    if (Date.now() > until) return { state: "waiting" };
  }
}
