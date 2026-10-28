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
 */
export const BLUR_CLIP_WIDTH = 24;
const BLUR_CLIP_SECONDS = 4;
const FPS = 12;

function pickMime(): { mime: string; type: "video/mp4" | "video/webm"; ext: "mp4" | "webm" } | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const m of ["video/mp4;codecs=avc1", "video/mp4"]) if (MediaRecorder.isTypeSupported(m)) return { mime: m, type: "video/mp4", ext: "mp4" };
  for (const m of ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]) if (MediaRecorder.isTypeSupported(m)) return { mime: m, type: "video/webm", ext: "webm" };
  return null;
}

export async function makeBlurClip(file: File): Promise<{ blob: Blob; ext: "mp4" | "webm"; type: string } | null> {
  if (typeof document === "undefined" || !("captureStream" in HTMLCanvasElement.prototype)) return null;
  const m = pickMime();
  if (!m) return null;
  const url = URL.createObjectURL(file);
  const v = document.createElement("video");
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
    const w = BLUR_CLIP_WIDTH;
    // even dimensions: some encoders refuse odd ones
    const h = Math.max(2, Math.round((w * v.videoHeight) / v.videoWidth / 2) * 2);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return null;
    ctx.filter = "blur(1.5px)";
    const stream = (canvas as HTMLCanvasElement & { captureStream(fps?: number): MediaStream }).captureStream(FPS);
    const rec = new MediaRecorder(stream, { mimeType: m.mime, videoBitsPerSecond: 40_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise<void>((r) => (rec.onstop = () => r()));
    let drawing = true;
    const draw = () => {
      if (!drawing) return;
      ctx.drawImage(v, 0, 0, w, h);
      window.setTimeout(draw, 1000 / FPS);
    };
    ctx.drawImage(v, 0, 0, w, h);
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
    URL.revokeObjectURL(url);
  }
}
