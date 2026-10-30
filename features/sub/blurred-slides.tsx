"use client";

import { useEffect, useRef, useState } from "react";

import { BlurredClip } from "@/features/sub/blurred-clip";
import { cn } from "@/lib/utils";

/** One slide of a locked post as the server sends it (lib/sub/blur-preview.ts BlurSlide) — never the file. */
export interface BlurSlideView {
  kind: "image" | "video";
  blurUrl?: string;
  blurVideoUrl?: string;
}

/** How long a slide holds before the show moves on — one loop of a blurred clip (lib/sub/blur-clip-plan.ts, 4 s). */
const SLIDE_MS = 4000;

/*
  A locked exclusive post, every item of it, BLURRED (owner, 2026-10-29: "unsubscribers should be able to slide through a
  multi post sideways but it will be blurred", and a video "plays but blurred" with no cover needed). Each slide is the
  item's own 20 px still or its 24 px clip — nothing in either to un-blur, so the CSS blur is the look, never the gate.
  Native scroll-snap (no gesture library), dots under it, and only the slide on screen plays (BlurredClip watches its
  own visibility). One slide, or none from the server, is the single preview it always was.

  🔴 IT PLAYS BY ITSELF (owner, 2026-10-29: "slide show doesn't auto play … nothing less than that"): an album moves to
  its next item every SLIDE_MS and wraps to the first, while the card is on screen and the tab is visible. A finger on it
  holds the show; it carries on SLIDE_MS after the finger lifts. One interval, no animation library, and nothing runs for
  a card off screen.
*/
export function BlurredSlides({ slides, cover, fallbackStill, fallbackClip, className }: { slides?: BlurSlideView[]; cover?: string | null; fallbackStill?: string | null; fallbackClip?: string | null; className?: string }) {
  const list: BlurSlideView[] = slides?.length ? slides : fallbackClip || fallbackStill || cover ? [{ kind: fallbackClip ? "video" : "image", blurUrl: fallbackStill ?? undefined, blurVideoUrl: fallbackClip ?? undefined }] : [];
  const row = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  const count = list.length;
  const many = count > 1;

  useEffect(() => {
    const el = row.current;
    if (!el || count < 2) return;
    let visible = false;
    let holding = false;
    let last = Date.now();
    const io =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(
            ([e]) => {
              visible = !!e?.isIntersecting;
              if (visible) last = Date.now();
            },
            { threshold: 0.5 },
          );
    if (io) io.observe(el);
    else visible = true;
    const hold = () => {
      holding = true;
    };
    const release = () => {
      holding = false;
      last = Date.now();
    };
    el.addEventListener("pointerdown", hold, { passive: true });
    el.addEventListener("pointerup", release, { passive: true });
    el.addEventListener("pointercancel", release, { passive: true });
    el.addEventListener("touchend", release, { passive: true });
    const tick = window.setInterval(() => {
      if (!visible || holding || document.hidden || Date.now() - last < SLIDE_MS) return;
      const w = el.clientWidth;
      if (!w) return;
      const next = (Math.round(el.scrollLeft / w) + 1) % count;
      // the wrap back to the first slide jumps; every other step glides
      el.scrollTo({ left: next * w, behavior: next === 0 ? "auto" : "smooth" });
      last = Date.now();
    }, 500);
    return () => {
      window.clearInterval(tick);
      io?.disconnect();
      el.removeEventListener("pointerdown", hold);
      el.removeEventListener("pointerup", release);
      el.removeEventListener("pointercancel", release);
      el.removeEventListener("touchend", release);
    };
  }, [count]);

  if (!count) return null;
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
