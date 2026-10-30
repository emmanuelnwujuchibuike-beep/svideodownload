/**
 * The moving preview of a locked exclusive video (owner, 2026-10-28: "let exclusive feed videos play, but blurred, to
 * users who haven't subscribed — it should autoplay and be blurred").
 *
 * The gate is kept the way the still preview keeps it (lib/sub/blur-preview.ts, 0263): a non-subscriber never receives
 * the video. This runs in the CREATOR's browser at publish time: the first seconds of the video are drawn into a canvas
 * only BLUR_CLIP_WIDTH pixels wide, blurred there, and recorded. The detail is destroyed before anything is uploaded —
 * there is nothing in the file to sharpen back into the video — so the clip can be public, like the still preview.
 * The viewer only scales it up behind a CSS blur so it reads as the video playing behind frosted glass.
 *
 * Best effort: no MediaRecorder / canvas capture (an old browser), or a video that won't decode, gives null and the
 * post keeps its still preview.
 *
 * Recipe 2 (owner, 2026-10-30: "lagging low quality inside the blur"), like the worker's (lib/sub/blur-clip-plan.ts):
 * the tiny frame is enlarged UPSCALE× onto a second canvas, smoothed and blurred, and THAT is recorded — no blocks for
 * the phone to scale up — at 24 fps, each frame drawn when the video has a new one. The worker still remakes this clip
 * with ffmpeg (it carries no BLUR_CLIP_MARK): a browser recording's frame timing is never as even.
 */
export const BLUR_CLIP_WIDTH = 24;
const BLUR_CLIP_SECONDS = 4;
const FPS = 24;
const UPSCALE = 4;

function pickMime(): { mime: string; type: "video/mp4" | "video/webm"; ext: "mp4" | "webm" } | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const m of ["video/mp4;codecs=avc1", "video/mp4"]) if (MediaRecorder.isTypeSupported(m)) return { mime: m, type: "video/mp4", ext: "mp4" };
  for (const m of ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]) if (MediaRecorder.isTypeSupported(m)) return { mime: m, type: "video/webm", ext: "webm" };
  return null;
}

/**
 * `source` is the picked file, or (0306 — an older post's video, made on the creator's own visit) a short-lived link to
 * their private file: read with CORS, so the canvas stays readable, and only the first seconds are ever streamed.
 */
export async function makeBlurClip(source: File | string, width: number = BLUR_CLIP_WIDTH): Promise<{ blob: Blob; ext: "mp4" | "webm"; type: string } | null> {
  if (typeof document === "undefined" || !("captureStream" in HTMLCanvasElement.prototype)) return null;
  const m = pickMime();
  if (!m) return null;
  const own = typeof source !== "string";
  const url = own ? URL.createObjectURL(source) : source;
  const v = document.createElement("video");
  if (!own) v.crossOrigin = "anonymous";
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  v.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      v.addEventListener("loadeddata", () => resolve(), { once: true });
      v.addEventListener("error", () => reject(new Error("decode")), { once: true });
      window.setTimeout(() => reject(new Error("timeout")), 15_000);
    });
    if (!v.videoWidth || !v.videoHeight) return null;
    // the post's blur level decides the size (lib/sub/blur-level.ts) — 24 px unless it is Light; bounded either way
    const w = Math.max(8, Math.min(64, Math.round(width) || BLUR_CLIP_WIDTH));
    // even dimensions: some encoders refuse odd ones
    const h = Math.max(2, Math.round((w * v.videoHeight) / v.videoWidth / 2) * 2);
    // the detail is destroyed here, at w px…
    const tiny = document.createElement("canvas");
    tiny.width = w;
    tiny.height = h;
    const tctx = tiny.getContext("2d", { alpha: false });
    // …and this enlarged, smoothed copy of it is what gets recorded
    const canvas = document.createElement("canvas");
    canvas.width = w * UPSCALE;
    canvas.height = h * UPSCALE;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!tctx || !ctx) return null;
    tctx.filter = "blur(1.5px)";
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.filter = `blur(${(UPSCALE * 0.6).toFixed(1)}px)`;
    const paint = () => {
      tctx.drawImage(v, 0, 0, w, h);
      ctx.drawImage(tiny, 0, 0, canvas.width, canvas.height);
    };
    const stream = (canvas as HTMLCanvasElement & { captureStream(fps?: number): MediaStream }).captureStream(FPS);
    const rec = new MediaRecorder(stream, { mimeType: m.mime, videoBitsPerSecond: 160_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise<void>((r) => (rec.onstop = () => r()));
    let drawing = true;
    // a frame per decoded video frame where the browser says when (even motion), a steady timer elsewhere
    const rvfc = (v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }).requestVideoFrameCallback?.bind(v);
    const draw = () => {
      if (!drawing) return;
      paint();
      if (rvfc) rvfc(draw);
      else window.setTimeout(draw, 1000 / FPS);
    };
    paint();
    rec.start();
    await v.play();
    draw();
    await new Promise<void>((r) => window.setTimeout(r, Math.min(BLUR_CLIP_SECONDS, Number.isFinite(v.duration) ? v.duration : BLUR_CLIP_SECONDS) * 1000));
    drawing = false;
    rec.stop();
    v.pause();
    stream.getTracks().forEach((t) => t.stop());
    await done;
    const blob = new Blob(chunks, { type: m.type });
    return blob.size ? { blob, ext: m.ext, type: m.type } : null;
  } catch {
    return null;
  } finally {
    v.removeAttribute("src");
    v.load();
    if (own) URL.revokeObjectURL(url);
  }
}
