"use client";

import { useEffect, useRef } from "react";

import { blurClass } from "@/lib/sub/blur-level";
import { cn } from "@/lib/utils";

/*
  A locked exclusive video, playing BLURRED and SILENT for a viewer without a subscription (0305 — owner, 2026-10-28:
  "it should auto play and be blurred"; 2026-10-29: "auto play like feed posts … blurred while it plays but without
  sound"). The file is a tiny clip (24 px, or 48 px when the creator chose Light — lib/sub/blur-level.ts): no detail
  exists in it to un-blur, so the CSS blur on top is only the look, never the gate. Muted, looped, inline, never
  controls; it plays while on screen, like a feed video.

  🔴 THE MOVEMENT MUST SHOW (owner, 2026-10-30: "the auto play should be obvious movement not too much thick blurred that
  the auto play doesn't even show"). The CSS blur used to be blur-xl (24 px) on top of the 24 px clip, which washed the
  motion out. It is now the creator's level, as a share of the frame's width (app/globals.css .sub-blur-*): enough to
  smooth the clip's pixels at any size ("cracking", 2026-10-30), little enough that the movement shows.

  ── Why it used to sit black on an iPhone (2026-10-29) ──────────────────────────
  · iOS starts a video without a tap only if it is muted AND inline when play() runs. React writes `muted` as a DOM
    property on a client render but not when it hydrates server HTML, and never as an attribute — so play() could be
    refused, and with no poster and nothing played, the tile stayed black. All of it is now set here, every way Safari
    reads it, before the first play(). No `autoPlay` attribute: it would start every clip on the page at once, off-screen
    slides included, and iOS decodes only so many videos at a time — the ones on screen must get them.
  · `preload="metadata"` and no poster left nothing on screen until playback: the clip is a few KB, so it preloads, and
    without a poster a `#t=0.001` fragment makes Safari paint the first frame.
  · Low Power Mode refuses every autoplay: the viewer's next touch anywhere starts the clips on screen.
  · Reduce Motion no longer stops it — feed videos autoplay under it too, and the owner asked for the same behaviour.
*/
export function BlurredClip({ src, poster, level, className }: { src: string; poster?: string | null; level?: unknown; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = true;
    v.defaultMuted = true;
    v.setAttribute("muted", "");
    v.setAttribute("playsinline", "");
    v.setAttribute("webkit-playsinline", "");

    let inView = typeof IntersectionObserver === "undefined";
    const tryPlay = () => {
      if (inView && v.paused) void v.play().catch(() => {});
    };
    v.addEventListener("loadeddata", tryPlay);
    v.addEventListener("canplay", tryPlay);
    // autoplay refused (Low Power Mode, a data saver): the next touch on the page is a gesture, and play() is allowed
    document.addEventListener("pointerdown", tryPlay, { passive: true });
    document.addEventListener("touchend", tryPlay, { passive: true });

    let io: IntersectionObserver | null = null;
    if (inView) tryPlay();
    else {
      io = new IntersectionObserver(
        ([e]) => {
          inView = !!e?.isIntersecting;
          if (inView) tryPlay();
          else v.pause();
        },
        { threshold: 0.25 },
      );
      io.observe(v);
    }
    return () => {
      io?.disconnect();
      v.removeEventListener("loadeddata", tryPlay);
      v.removeEventListener("canplay", tryPlay);
      document.removeEventListener("pointerdown", tryPlay);
      document.removeEventListener("touchend", tryPlay);
      v.pause();
    };
  }, [src]);
  return (
    <video
      ref={ref}
      // no poster: start a hair past 0 so Safari paints a frame before (or without) playback
      src={poster ? src : `${src}#t=0.001`}
      poster={poster ?? undefined}
      muted
      loop
      playsInline
      preload="auto"
      aria-hidden
      tabIndex={-1}
      disablePictureInPicture
      className={cn("pointer-events-none object-cover", blurClass(level), className)}
    />
  );
}
