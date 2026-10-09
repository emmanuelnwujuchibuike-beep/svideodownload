/// <reference lib="webworker" />

/**
 * Off-main-thread image optimizer for ad creatives (0208). The advertiser's
 * own browser does the resize, so a large photo never travels to our servers
 * at full size and nothing here blocks the page.
 *
 *   · aspect ratio preserved exactly — fitWithin scales both edges by ONE factor
 *   · never enlarged, never cropped, never stretched
 *   · EXIF orientation applied (imageOrientation: "from-image"), so a portrait
 *     phone photo stays portrait; the re-encode drops all other metadata
 *   · WebP output keeps transparency
 */

import { fitWithin } from "@/lib/ads-platform/media-spec";

type In = { blob: Blob; longEdge: number; quality: number };
type Out = { ok: true; blob: Blob; width: number; height: number } | { ok: false; error: string };

self.onmessage = async (e: MessageEvent<In>) => {
  const { blob, longEdge, quality } = e.data;
  const reply = (m: Out) => (self as unknown as Worker).postMessage(m);
  try {
    const probe = await createImageBitmap(blob, { imageOrientation: "from-image" });
    const target = fitWithin(probe.width, probe.height, longEdge);
    let bmp = probe;
    if (target.width !== probe.width || target.height !== probe.height) {
      probe.close();
      bmp = await createImageBitmap(blob, { imageOrientation: "from-image", resizeWidth: target.width, resizeHeight: target.height, resizeQuality: "high" });
    }
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(bmp, 0, 0);
    const out = await canvas.convertToBlob({ type: "image/webp", quality: Math.min(1, Math.max(0.4, quality / 100)) });
    const w = bmp.width;
    const h = bmp.height;
    bmp.close();
    // a browser that cannot encode WebP hands back PNG — still valid, still proportional
    reply({ ok: true, blob: out, width: w, height: h });
  } catch (err) {
    reply({ ok: false, error: err instanceof Error ? err.message : "optimize_failed" });
  }
};
