"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

/*
  A locked exclusive video, playing BLURRED for a viewer without a subscription (0305 — owner, 2026-10-28: "it should
  auto play and be blurred"). The file is a 24 px clip made in the creator's browser (lib/media/make-blur-clip.ts):
  no detail exists in it to un-blur, so the CSS blur on top is only the look, never the gate. Muted, looped, inline,
  never controls; it plays only while on screen and stops under Reduce Motion (the still preview shows instead).
*/
export function BlurredClip({ src, poster, className }: { src: string; poster?: string | null; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    if (typeof IntersectionObserver === "undefined") {
      void v.play().catch(() => {});
      return;
    }
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting) void v.play().catch(() => {});
      else v.pause();
    }, { threshold: 0.25 });
    io.observe(v);
    return () => {
      io.disconnect();
      v.pause();
    };
  }, [src]);
  return (
    <video
      ref={ref}
      src={src}
      poster={poster ?? undefined}
      muted
      loop
      playsInline
      preload="metadata"
      aria-hidden
      tabIndex={-1}
      disablePictureInPicture
      className={cn("pointer-events-none object-cover blur-xl", className)}
    />
  );
}
