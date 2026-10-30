"use client";

import { useEffect, useRef } from "react";

import { BLUR_COVER } from "@/features/sub/blur-frame";
import { BLUR_CLIP_WIDTH_FOR, BLUR_LEVEL_HINT, BLUR_LEVEL_LABEL, BLUR_LEVELS, BLUR_STILL_WIDTH_FOR, blurClass, type BlurLevel } from "@/lib/sub/blur-level";
import { cn } from "@/lib/utils";

/*
  The creator's choice of how blurry a locked post looks to visitors (owner, 2026-10-30: "Make users be able to set how
  blurry they want the post to be") — lib/sub/blur-level.ts.
*/
export function BlurLevelPicker({ value, onChange, disabled, tone = "light", className }: { value: BlurLevel; onChange: (next: BlurLevel) => void; disabled?: boolean; tone?: "light" | "dark"; className?: string }) {
  const dark = tone === "dark";
  return (
    <fieldset className={className} disabled={disabled}>
      <legend className="mb-1.5 text-[13px] font-semibold">How blurry visitors see it</legend>
      <div role="radiogroup" aria-label="How blurry visitors see it" className="grid grid-cols-3 gap-1.5">
        {BLUR_LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={value === level}
            onClick={() => onChange(level)}
            className={cn(
              "min-h-11 rounded-2xl border px-2 py-2 text-[13.5px] font-semibold transition disabled:opacity-60",
              dark
                ? value === level
                  ? "border-white bg-white text-zinc-950"
                  : "border-white/20 text-white"
                : value === level
                  ? "border-primary bg-primary/[0.07] text-primary ring-1 ring-primary/40"
                  : "border-black/[0.08] dark:border-white/10",
            )}
          >
            {BLUR_LEVEL_LABEL[level]}
          </button>
        ))}
      </div>
      <p className={cn("mt-1.5 text-[12px] leading-snug", dark ? "text-white/70" : "text-muted-foreground")}>{BLUR_LEVEL_HINT[value]}</p>
    </fieldset>
  );
}

/*
  EXACTLY what a visitor gets at a level, made here from the creator's own file and never uploaded: the first item drawn
  at the size the level stores (a video at the clip's width and frame rate, still playing; a photo at the still's
  width), stretched to the frame and blurred with the level's CSS — the same two steps the real preview goes through.
*/
export function VisitorBlurPreview({ src, kind, level }: { src: string; kind: "image" | "video"; level: BlurLevel }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const width = kind === "video" ? BLUR_CLIP_WIDTH_FOR[level] : BLUR_STILL_WIDTH_FOR[level];
    let stopped = false;
    let timer = 0;
    const draw = (el: HTMLImageElement | HTMLVideoElement, w: number, h: number) => {
      if (stopped || !w || !h) return;
      const height = Math.max(2, Math.round((width * h) / w));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      ctx.drawImage(el, 0, 0, width, height);
    };
    if (kind === "image") {
      const img = new Image();
      img.onload = () => draw(img, img.naturalWidth, img.naturalHeight);
      img.src = src;
      return () => {
        stopped = true;
        img.onload = null;
      };
    }
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.loop = true;
    video.src = src;
    const tick = () => {
      if (stopped) return;
      draw(video, video.videoWidth, video.videoHeight);
      // the clip's own frame rate (lib/sub/blur-clip-plan.ts BLUR_CLIP_FPS, 24 fps)
      timer = window.setTimeout(tick, 1000 / 24);
    };
    const start = () => {
      void video.play().catch(() => {});
      tick();
    };
    video.addEventListener("loadeddata", start, { once: true });
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      video.removeEventListener("loadeddata", start);
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [src, kind, level]);
  return <canvas ref={canvasRef} aria-hidden className={cn(BLUR_COVER, blurClass(level))} />;
}
