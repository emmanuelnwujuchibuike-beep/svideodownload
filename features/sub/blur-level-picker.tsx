"use client";

import { useEffect, useRef } from "react";

import { BLUR_COVER } from "@/features/sub/blur-frame";
import { BLUR_CLIP_FPS } from "@/lib/sub/blur-clip-plan";
import { BLUR_AMOUNT_MAX, BLUR_AMOUNT_MIN, BLUR_LEVEL_LABEL, blurAmountOf, blurBand, blurClass, blurClipWidth, blurHint, blurLevelForAmount, blurStillWidth, type BlurLevel } from "@/lib/sub/blur-level";
import { cn } from "@/lib/utils";

/*
  The creator's choice of how blurry a locked post looks to visitors (owner, 2026-10-30: "Make users be able to set how
  blurry they want the post to be"; then "drag it to the right to increase and drag to left to reduce like reducing
  volume") — a slider, lib/sub/blur-level.ts. The far left is Light: the least the stored preview ever holds.
*/
export function BlurLevelPicker({ value, onChange, disabled, tone = "light", className }: { value: BlurLevel; onChange: (next: BlurLevel) => void; disabled?: boolean; tone?: "light" | "dark"; className?: string }) {
  const dark = tone === "dark";
  const amount = blurAmountOf(value);
  const band = BLUR_LEVEL_LABEL[blurBand(value)];
  const filled = `${((amount - BLUR_AMOUNT_MIN) / (BLUR_AMOUNT_MAX - BLUR_AMOUNT_MIN)) * 100}%`;
  return (
    <fieldset className={className} disabled={disabled}>
      <legend className="mb-1.5 flex w-full items-center justify-between text-[13px] font-semibold">
        <span>How blurry visitors see it</span>
        <span className={cn("rounded-full px-2 py-0.5 text-[11.5px] font-bold tabular-nums", dark ? "bg-white/15 text-white" : "bg-primary/[0.08] text-primary")}>
          {band} · {amount}%
        </span>
      </legend>
      <input
        type="range"
        min={BLUR_AMOUNT_MIN}
        max={BLUR_AMOUNT_MAX}
        step={1}
        value={amount}
        onChange={(e) => onChange(blurLevelForAmount(Number(e.target.value)))}
        aria-label="How blurry visitors see it"
        aria-valuetext={`${band}, ${amount} percent`}
        style={{ background: `linear-gradient(to right, rgb(124 58 237) 0%, rgb(59 130 246) ${filled}, ${dark ? "rgb(255 255 255 / 0.18)" : "rgb(0 0 0 / 0.08)"} ${filled})` }}
        className={cn(
          "h-2.5 w-full cursor-pointer appearance-none rounded-full outline-none transition-opacity disabled:cursor-default disabled:opacity-60",
          "focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2",
          "[&::-webkit-slider-thumb]:h-7 [&::-webkit-slider-thumb]:w-7 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-[3px] [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-gradient-to-br [&::-webkit-slider-thumb]:from-violet-600 [&::-webkit-slider-thumb]:to-blue-500 [&::-webkit-slider-thumb]:shadow-[0_4px_14px_-2px_rgb(76_29_149/0.55)] [&::-webkit-slider-thumb]:transition-transform active:[&::-webkit-slider-thumb]:scale-110",
          "[&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:w-6 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-[3px] [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-violet-600 [&::-moz-range-thumb]:shadow-[0_4px_14px_-2px_rgb(76_29_149/0.55)]",
        )}
      />
      <div className={cn("mt-1 flex justify-between text-[11.5px] font-semibold", dark ? "text-white/60" : "text-muted-foreground")}>
        <span>Light</span>
        <span>Strong</span>
      </div>
      <p className={cn("mt-1 text-[12px] leading-snug", dark ? "text-white/70" : "text-muted-foreground")}>{blurHint(value)}</p>
    </fieldset>
  );
}

/*
  EXACTLY what a visitor gets at a level, made here from the creator's own file and never uploaded: the first item drawn
  at the size the level's BAND stores (a video at the clip's width and frame rate, still playing; a photo at the still's
  width), stretched to the frame and blurred with the level's CSS — the same two steps the real preview goes through.
  Dragging the slider only changes the CSS; the drawing restarts only when the stored size changes band.
*/
export function VisitorBlurPreview({ src, kind, level }: { src: string; kind: "image" | "video"; level: BlurLevel }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const width = kind === "video" ? blurClipWidth(level) : blurStillWidth(level);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
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
      // the stored clip's own frame rate (lib/sub/blur-clip-plan.ts BLUR_CLIP_FPS)
      timer = window.setTimeout(tick, 1000 / BLUR_CLIP_FPS);
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
  }, [src, kind, width]);
  return <canvas ref={canvasRef} aria-hidden className={cn(BLUR_COVER, blurClass(level))} />;
}
