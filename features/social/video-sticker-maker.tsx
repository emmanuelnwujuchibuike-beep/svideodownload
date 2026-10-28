"use client";

import { ArrowLeft, Film, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { haptic } from "@/lib/motion/haptics";
import { VIDEO_STICKER_EDGE } from "@/lib/social/video-stickers";
import { uploadPostMedia } from "@/lib/storage/client-upload";
import { cn } from "@/lib/utils";

/*
  Make a video sticker (owner, 2026-10-28): pick a video, drag the square to the part you want, slide to the 3 seconds
  you want, and it becomes a sticker in your library.

  Everything happens in the browser, once: the chosen 3 s play into a 320 px canvas that a MediaRecorder captures
  (MP4 where the browser can, WebM otherwise), silent. Then the clip and a poster frame upload to the member's own
  post-media folders and /api/stickers/video records them. No server encoding, nothing running after it's done — the
  source file's object URL and the recorder are released as soon as the sticker is made or the maker closes.
*/

const CLIP_S = 3;
const EDGE = VIDEO_STICKER_EDGE;

type Made = { id: string; videoUrl: string; posterUrl: string };

function pickMime(): { mime: string; type: "video/mp4" | "video/webm"; ext: "mp4" | "webm" } | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const m of ["video/mp4;codecs=avc1", "video/mp4"]) if (MediaRecorder.isTypeSupported(m)) return { mime: m, type: "video/mp4", ext: "mp4" };
  for (const m of ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]) if (MediaRecorder.isTypeSupported(m)) return { mime: m, type: "video/webm", ext: "webm" };
  return null;
}

const canRecord = () => typeof document !== "undefined" && "captureStream" in HTMLCanvasElement.prototype && !!pickMime();

export function VideoStickerMaker({ onMade, onBack }: { onMade: (s: Made) => void; onBack: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const [dur, setDur] = useState(0);
  const [start, setStart] = useState(0);
  const [nat, setNat] = useState({ w: 0, h: 0 });
  // the crop square, in the video's own pixels: its edge and top-left corner
  const [crop, setCrop] = useState({ x: 0, y: 0, size: 0 });
  const [busy, setBusy] = useState<null | "recording" | "uploading">(null);
  const [err, setErr] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const supported = useRef(canRecord());

  useEffect(() => () => {
    if (src) URL.revokeObjectURL(src);
  }, [src]);

  const pick = (f: File) => {
    setErr(null);
    if (!f.type.startsWith("video/")) return setErr("Choose a video.");
    if (f.size > 300 * 1024 * 1024) return setErr("That video is too large. Pick a shorter one.");
    if (src) URL.revokeObjectURL(src);
    setSrc(URL.createObjectURL(f));
    setStart(0);
  };

  // the preview loops the chosen 3 seconds only (cheap: one video element, paused when the maker closes)
  useEffect(() => {
    const v = video.current;
    if (!v || !src) return;
    const loop = () => {
      if (v.currentTime >= start + CLIP_S || v.currentTime < start - 0.25) v.currentTime = start;
    };
    v.addEventListener("timeupdate", loop);
    return () => v.removeEventListener("timeupdate", loop);
  }, [src, start]);

  const onMeta = () => {
    const v = video.current!;
    const w = v.videoWidth;
    const h = v.videoHeight;
    setDur(Number.isFinite(v.duration) ? v.duration : 0);
    setNat({ w, h });
    const size = Math.min(w, h);
    setCrop({ x: Math.round((w - size) / 2), y: Math.round((h - size) / 2), size });
    void v.play().catch(() => {});
  };

  // display scale: the stage shows the whole frame at its width
  const scale = () => (stage.current && nat.w ? stage.current.clientWidth / nat.w : 1);
  const clampCrop = (x: number, y: number, size: number) => ({
    size,
    x: Math.max(0, Math.min(nat.w - size, Math.round(x))),
    y: Math.max(0, Math.min(nat.h - size, Math.round(y))),
  });

  const make = async () => {
    const v = video.current;
    const m = pickMime();
    if (!v || !m || !crop.size || busy) return;
    setErr(null);
    setBusy("recording");
    haptic("light");
    try {
      const canvas = document.createElement("canvas");
      canvas.width = EDGE;
      canvas.height = EDGE;
      const ctx = canvas.getContext("2d", { alpha: false })!;
      v.pause();
      v.currentTime = start;
      await new Promise<void>((r) => v.addEventListener("seeked", () => r(), { once: true }));
      ctx.drawImage(v, crop.x, crop.y, crop.size, crop.size, 0, 0, EDGE, EDGE);
      const poster = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.8));
      const stream = (canvas as HTMLCanvasElement & { captureStream(fps?: number): MediaStream }).captureStream(24);
      const rec = new MediaRecorder(stream, { mimeType: m.mime, videoBitsPerSecond: 700_000 });
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const done = new Promise<void>((r) => (rec.onstop = () => r()));
      let frames = true;
      const draw = () => {
        if (!frames) return;
        ctx.drawImage(v, crop.x, crop.y, crop.size, crop.size, 0, 0, EDGE, EDGE);
        requestAnimationFrame(draw);
      };
      rec.start();
      await v.play();
      requestAnimationFrame(draw);
      const began = performance.now();
      await new Promise<void>((r) => window.setTimeout(r, CLIP_S * 1000));
      frames = false;
      rec.stop();
      v.pause();
      stream.getTracks().forEach((t) => t.stop());
      await done;
      const clip = new Blob(chunks, { type: m.type });
      const durationMs = Math.min(3300, Math.round(performance.now() - began));
      if (!clip.size || !poster) throw new Error("The sticker couldn't be recorded. Try again.");
      setBusy("uploading");
      const [videoUrl, posterUrl] = await Promise.all([
        uploadPostMedia({ data: clip, kind: "video", ext: m.ext, contentType: m.type }),
        uploadPostMedia({ data: poster, kind: "image", ext: "jpg", contentType: "image/jpeg" }),
      ]);
      const res = await fetch("/api/stickers/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrl, posterUrl, durationMs, width: EDGE, height: EDGE, mime: m.type }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; sticker?: Made; error?: string } | null;
      if (!res.ok || !json?.sticker) throw new Error(json?.error ?? "Couldn't save the sticker.");
      haptic("medium");
      onMade(json.sticker);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't make the sticker.");
      void v.play().catch(() => {});
    } finally {
      setBusy(null);
    }
  };

  const s = scale();
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onBack} aria-label="Back to stickers" className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <p className="text-sm font-bold">Make a sticker</p>
      </div>

      {!supported.current ? (
        <p className="rounded-2xl bg-secondary/60 px-4 py-6 text-center text-sm text-muted-foreground">This browser can&apos;t make video stickers. Try the latest Chrome or Safari.</p>
      ) : !src ? (
        <label className="flex h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border text-muted-foreground">
          <Film className="h-6 w-6" aria-hidden />
          <span className="text-sm font-semibold">Choose a video</span>
          <span className="text-xs">You&apos;ll pick a square and 3 seconds</span>
          <input type="file" accept="video/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ""; }} />
        </label>
      ) : (
        <>
          <div ref={stage} className="relative mx-auto w-full max-w-[18rem] overflow-hidden rounded-2xl bg-black" style={{ aspectRatio: nat.w && nat.h ? `${nat.w} / ${nat.h}` : "1" }}>
            <video ref={video} src={src} muted playsInline preload="metadata" onLoadedMetadata={onMeta} className="absolute inset-0 h-full w-full" />
            {crop.size ? (
              <div
                role="slider"
                aria-label="Drag to choose the part of the video"
                aria-valuetext={`${Math.round((crop.x / Math.max(1, nat.w - crop.size)) * 100) || 0}% across`}
                tabIndex={0}
                onPointerDown={(e) => {
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  drag.current = { px: e.clientX, py: e.clientY, x: crop.x, y: crop.y };
                }}
                onPointerMove={(e) => {
                  const d = drag.current;
                  if (!d) return;
                  setCrop(clampCrop(d.x + (e.clientX - d.px) / s, d.y + (e.clientY - d.py) / s, crop.size));
                }}
                onPointerUp={() => (drag.current = null)}
                onPointerCancel={() => (drag.current = null)}
                onKeyDown={(e) => {
                  const step = Math.round(crop.size * 0.05);
                  if (e.key === "ArrowLeft") setCrop(clampCrop(crop.x - step, crop.y, crop.size));
                  if (e.key === "ArrowRight") setCrop(clampCrop(crop.x + step, crop.y, crop.size));
                  if (e.key === "ArrowUp") setCrop(clampCrop(crop.x, crop.y - step, crop.size));
                  if (e.key === "ArrowDown") setCrop(clampCrop(crop.x, crop.y + step, crop.size));
                }}
                className="absolute cursor-grab touch-none rounded-xl border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.5)] active:cursor-grabbing"
                style={{ left: crop.x * s, top: crop.y * s, width: crop.size * s, height: crop.size * s }}
              />
            ) : null}
          </div>

          <label className="block text-xs font-semibold text-muted-foreground">
            Size
            <input
              type="range"
              min={0.4}
              max={1}
              step={0.01}
              value={nat.w ? crop.size / Math.min(nat.w, nat.h) : 1}
              onChange={(e) => {
                const size = Math.round(Math.min(nat.w, nat.h) * Number(e.target.value));
                const cx = crop.x + crop.size / 2;
                const cy = crop.y + crop.size / 2;
                setCrop(clampCrop(cx - size / 2, cy - size / 2, size));
              }}
              className="mt-1 w-full accent-[#2F5BEA]"
            />
          </label>
          <label className="block text-xs font-semibold text-muted-foreground">
            The 3 seconds · from {start.toFixed(1)} s
            <input
              type="range"
              min={0}
              max={Math.max(0, dur - CLIP_S)}
              step={0.1}
              value={start}
              disabled={dur <= CLIP_S}
              onChange={(e) => {
                const t = Number(e.target.value);
                setStart(t);
                if (video.current) video.current.currentTime = t;
              }}
              className="mt-1 w-full accent-[#2F5BEA]"
            />
          </label>

          {err ? <p role="alert" className="text-xs font-semibold text-rose-600">{err}</p> : null}
          <button
            type="button"
            onClick={() => void make()}
            disabled={!!busy || !crop.size}
            className={cn("inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-foreground text-sm font-bold text-background transition active:scale-[0.98] disabled:opacity-60")}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {busy === "recording" ? "Making your sticker…" : busy === "uploading" ? "Saving…" : "Make sticker"}
          </button>
        </>
      )}
      {err && !src ? <p role="alert" className="text-xs font-semibold text-rose-600">{err}</p> : null}
    </div>
  );
}
