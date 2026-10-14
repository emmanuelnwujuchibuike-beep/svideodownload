"use client";

import { markPlacement } from "@/lib/media/watermark-args";

/**
 * Stamps the download watermark onto a photo, in the browser (owner,
 * 2026-10-14). The mark is the same PNG the worker burns into videos
 * (/api/watermark/mark), placed by the same `markPlacement` the worker's
 * ffmpeg filter uses.
 *
 * The photo's bytes are already a same-origin blob by the time this runs
 * (save-to-device.ts), so the canvas is never tainted.
 */
export async function stampImageWatermark(photo: Blob, handle: string): Promise<Blob> {
  const [img, mark] = await Promise.all([createImageBitmap(photo), loadMark(handle)]);
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(img, 0, 0);
  const p = markPlacement({ width: img.width, height: img.height });
  const h = Math.round((p.width * mark.height) / mark.width);
  ctx.drawImage(mark, p.x, img.height - h - p.inset, p.width, h);
  img.close();
  const type = photo.type === "image/png" ? "image/png" : "image/jpeg";
  const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.92));
  if (!out) throw new Error("encode failed");
  return out;
}

async function loadMark(handle: string): Promise<ImageBitmap> {
  const res = await fetch(`/api/watermark/mark?h=${encodeURIComponent(handle)}`);
  if (!res.ok) throw new Error("mark unavailable");
  return createImageBitmap(await res.blob());
}
