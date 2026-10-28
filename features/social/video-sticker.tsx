"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

/*
  One video sticker (0303): a ≤3-second square silent clip, looping. "Smooth, fast, never over heat" (owner,
  2026-10-28): it shows its poster until it is on screen, plays only while on screen, and stops the moment it leaves —
  a long comment list never decodes more than the few stickers you can see. No controls, no sound, no layout shift
  (square box, poster first).
*/

const playing = new Set<HTMLVideoElement>();
let observer: IntersectionObserver | null = null;

function watch(v: HTMLVideoElement) {
  if (typeof IntersectionObserver === "undefined") return;
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const el = e.target as HTMLVideoElement;
        if (e.isIntersecting && !document.hidden) {
          playing.add(el);
          void el.play().catch(() => {});
        } else {
          playing.delete(el);
          el.pause();
        }
      }
    },
    { rootMargin: "80px 0px" },
  );
  observer.observe(v);
}

function unwatch(v: HTMLVideoElement) {
  observer?.unobserve(v);
  playing.delete(v);
}

// a hidden tab plays nothing
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    for (const v of playing) {
      if (document.hidden) v.pause();
      else void v.play().catch(() => {});
    }
  });
}

export function VideoSticker({ videoUrl, posterUrl, size = 96, className, label = "Sticker" }: { videoUrl: string; posterUrl: string; size?: number; className?: string; label?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    watch(v);
    return () => unwatch(v);
  }, []);
  return (
    <video
      ref={ref}
      src={videoUrl}
      poster={posterUrl}
      muted
      loop
      playsInline
      preload="none"
      disablePictureInPicture
      disableRemotePlayback
      aria-label={label}
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className={cn("pointer-events-none select-none rounded-2xl bg-black/5 object-cover", className)}
    />
  );
}
