/**
 * A small JPEG preview of a photo or a video's first frame, made on the device before upload
 * (owner 2026-10-12: SUB post covers "take ages … cover should load instantly"). The gallery
 * tile then loads ~30 kB instead of a multi-megabyte original. Browser-only; returns null on
 * any failure — a post never fails because its preview could not be made.
 */
export const THUMB_EDGE = 480;

function draw(src: CanvasImageSource, w: number, h: number): Promise<Blob | null> {
  if (!w || !h) return Promise.resolve(null);
  const scale = Math.min(1, THUMB_EDGE / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.74));
}

/** The video's own size too, which the composer did not know for a video. */
export async function makeThumb(file: File): Promise<{ blob: Blob | null; width: number | null; height: number | null }> {
  try {
    if (file.type.startsWith("image/")) {
      const bmp = await createImageBitmap(file);
      const out = { blob: await draw(bmp, bmp.width, bmp.height), width: bmp.width, height: bmp.height };
      bmp.close();
      return out;
    }
    if (file.type.startsWith("video/")) {
      const url = URL.createObjectURL(file);
      try {
        const v = document.createElement("video");
        v.muted = true;
        v.playsInline = true;
        v.preload = "auto";
        v.src = url;
        await new Promise<void>((resolve, reject) => {
          const t = window.setTimeout(() => reject(new Error("timeout")), 8000);
          v.onloadeddata = () => {
            v.currentTime = Math.min(0.1, (v.duration || 1) / 2);
          };
          v.onseeked = () => {
            window.clearTimeout(t);
            resolve();
          };
          v.onerror = () => {
            window.clearTimeout(t);
            reject(new Error("decode"));
          };
        });
        return { blob: await draw(v, v.videoWidth, v.videoHeight), width: v.videoWidth || null, height: v.videoHeight || null };
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  } catch {
    /* no preview — the original still uploads */
  }
  return { blob: null, width: null, height: null };
}
