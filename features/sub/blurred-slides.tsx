"use client";

import { useRef, useState } from "react";

import { BlurredClip } from "@/features/sub/blurred-clip";
import { cn } from "@/lib/utils";

/** One slide of a locked post as the server sends it (lib/sub/blur-preview.ts BlurSlide) — never the file. */
export interface BlurSlideView {
  kind: "image" | "video";
  blurUrl?: string;
  blurVideoUrl?: string;
}

/*
  A locked exclusive post, every item of it, BLURRED (owner, 2026-10-29: "unsubscribers should be able to slide through a
  multi post sideways but it will be blurred", and a video "plays but blurred" with no cover needed). Each slide is the
  item's own 20 px still or its 24 px clip — nothing in either to un-blur, so the CSS blur is the look, never the gate.
  Native scroll-snap (no gesture library), dots under it, and only the slide on screen plays (BlurredClip watches its
  own visibility). One slide, or none from the server, is the single preview it always was.
*/
export function BlurredSlides({ slides, cover, fallbackStill, fallbackClip, className }: { slides?: BlurSlideView[]; cover?: string | null; fallbackStill?: string | null; fallbackClip?: string | null; className?: string }) {
  const list: BlurSlideView[] = slides?.length ? slides : fallbackClip || fallbackStill || cover ? [{ kind: fallbackClip ? "video" : "image", blurUrl: fallbackStill ?? undefined, blurVideoUrl: fallbackClip ?? undefined }] : [];
  const row = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  if (!list.length) return null;
  const many = list.length > 1;
  return (
    <div className={cn("absolute inset-0", className)}>
      <div
        ref={row}
        // a sideways swipe belongs to this row, never to the page or a tab swipe around it
        data-hscroll
        onScroll={(e) => {
          const el = e.currentTarget;
          setAt(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
        }}
        className={cn("flex h-full w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", many ? "touch-pan-x" : "overflow-hidden")}
      >
        {list.map((s, i) => {
          // the first slide may wear the creator's public cover as its first frame; the rest their own still
          const still = s.blurUrl ?? (i === 0 ? (cover ?? undefined) : undefined);
          return (
            <div key={i} className="relative h-full w-full shrink-0 snap-center overflow-hidden">
              {s.blurVideoUrl ? (
                <BlurredClip src={s.blurVideoUrl} poster={i === 0 && cover ? cover : still} className="absolute -inset-5 h-[calc(100%+2.5rem)] w-[calc(100%+2.5rem)]" />
              ) : still ? (
                // eslint-disable-next-line @next/next/no-img-element -- an inline 20 px data URL, or the public cover
                <img src={still} alt="" aria-hidden loading="lazy" decoding="async" className="absolute -inset-5 h-[calc(100%+2.5rem)] w-[calc(100%+2.5rem)] object-cover blur-xl" />
              ) : null}
            </div>
          );
        })}
      </div>
      {many ? (
        <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-3 z-[1] flex justify-center gap-1.5">
          {list.map((_, i) => (
            <span key={i} className={cn("h-1.5 rounded-full bg-white transition-all motion-reduce:transition-none", i === at ? "w-4 opacity-100" : "w-1.5 opacity-55")} />
          ))}
        </span>
      ) : null}
    </div>
  );
}
