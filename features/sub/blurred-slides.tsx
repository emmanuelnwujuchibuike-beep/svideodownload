"use client";

import { useEffect, useRef, useState } from "react";

import { BLUR_COVER } from "@/features/sub/blur-frame";
import { BlurredClip } from "@/features/sub/blurred-clip";
import { BLUR_FRAME_CLASS, blurClass } from "@/lib/sub/blur-level";
import { cn } from "@/lib/utils";

/** One slide of a locked post as the server sends it (lib/sub/blur-preview.ts BlurSlide) — never the file. */
export interface BlurSlideView {
  kind: "image" | "video";
  blurUrl?: string;
  blurVideoUrl?: string;
}

/** How long a slide holds before the show moves on — one loop of a blurred clip (lib/sub/blur-clip-plan.ts, 4 s). */
const SLIDE_MS = 4000;
/** How long the snap stays released for a glide — longer than the browser's own smooth scroll takes. */
const GLIDE_SETTLE_MS = 700;

/*
  A locked exclusive post, every item of it, BLURRED (owner, 2026-10-29: "unsubscribers should be able to slide through a
  multi post sideways but it will be blurred", and a video "plays but blurred" with no cover needed). Each slide is the
  item's own tiny still or clip — nothing in either to un-blur, so the CSS blur is the look, never the gate, and its
  strength is the creator's choice (lib/sub/blur-level.ts). Native scroll-snap for the finger, dots under it, and only the
  slide on screen plays (BlurredClip watches its own visibility). One slide, or none from the server, is the single
  preview it always was.

  🔴 IT PLAYS BY ITSELF (owner, 2026-10-29: "slide show doesn't auto play"; 2026-10-30, again): an album moves to its next
  item every SLIDE_MS and wraps to the first, while the card is on screen and the tab is visible; a finger on it holds the
  show, which carries on SLIDE_MS after the finger lifts.

  ── Why it did not move on an iPhone, and showed a dark strip at the right (2026-10-30) ──────────────
  The step was a smooth scrollTo() on a mandatory-snap row. WebKit snaps a programmatic smooth scroll back toward the
  slide it started from, so the show never advanced — and the scroll could stop a few points along, leaving the next
  slide's unpainted edge as a dark band at the right until a swipe re-snapped it. The snap is now RELEASED for the glide
  (the browser's own smooth scroll then runs to the end) and put back on the exact slide edge once it settles. A show
  also always starts flush on its first slide.

  ── Why the page would not scroll over it ─────────────────────────────────────
  The row said `touch-action: pan-x` — to a phone, "this element only pans sideways", so a vertical drag that started on a
  slide went nowhere. It is now pan-x pan-y: the browser takes whichever direction the finger moves.
*/
export function BlurredSlides({ slides, cover, fallbackStill, fallbackClip, level, className }: { slides?: BlurSlideView[]; cover?: string | null; fallbackStill?: string | null; fallbackClip?: string | null; level?: unknown; className?: string }) {
  const list: BlurSlideView[] = slides?.length ? slides : fallbackClip || fallbackStill || cover ? [{ kind: fallbackClip ? "video" : "image", blurUrl: fallbackStill ?? undefined, blurVideoUrl: fallbackClip ?? undefined }] : [];
  const row = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  const count = list.length;
  const many = count > 1;

  useEffect(() => {
    const el = row.current;
    if (!el) return;
    // flush on the first slide, whatever a previous layout or restore left behind
    el.scrollLeft = 0;
    if (count < 2) return;
    let visible = false;
    let holding = false;
    let last = Date.now();
    let gliding = false;
    let settle = 0;
    const stopGlide = () => {
      window.clearTimeout(settle);
      gliding = false;
      el.style.scrollSnapType = "";
    };
    const glide = (to: number) => {
      stopGlide();
      // the wrap back to the first slide jumps (a snap edge, so the snap can stay on)
      if (to === 0 || Math.abs(to - el.scrollLeft) < 1) {
        el.scrollLeft = to;
        return;
      }
      // released while it glides: WebKit pulls a programmatic smooth scroll on a snap row back to where it started
      el.style.scrollSnapType = "none";
      gliding = true;
      el.scrollTo({ left: to, behavior: "smooth" });
      settle = window.setTimeout(() => {
        gliding = false;
        el.scrollLeft = to;
        el.style.scrollSnapType = "";
      }, GLIDE_SETTLE_MS);
    };
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
      // the finger wins: an unfinished glide gives the row back to the snap at once
      stopGlide();
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
      if (!visible || holding || document.hidden || gliding || Date.now() - last < SLIDE_MS) return;
      const w = el.clientWidth;
      if (!w) return;
      glide(((Math.round(el.scrollLeft / w) + 1) % count) * w);
      last = Date.now();
    }, 250);
    return () => {
      window.clearInterval(tick);
      stopGlide();
      io?.disconnect();
      el.removeEventListener("pointerdown", hold);
      el.removeEventListener("pointerup", release);
      el.removeEventListener("pointercancel", release);
      el.removeEventListener("touchend", release);
    };
  }, [count]);

  if (!count) return null;
  const look = blurClass(level);
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
        className={cn("flex h-full w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", many ? "[touch-action:pan-x_pan-y]" : "overflow-hidden")}
      >
        {list.map((s, i) => {
          // each slide shows its OWN blurred still; an old post's public cover is only the first slide's last resort (owner,
          // 2026-10-30: the blur, not the "old pattern of using cover picture") — and it is blurred like everything else
          const still = s.blurUrl ?? (i === 0 ? (cover ?? undefined) : undefined);
          return (
            <div key={i} className={cn("relative h-full w-full shrink-0 snap-start snap-always overflow-hidden", BLUR_FRAME_CLASS)}>
              {s.blurVideoUrl ? (
                <BlurredClip src={s.blurVideoUrl} poster={still} level={level} className={BLUR_COVER} />
              ) : still ? (
                // eslint-disable-next-line @next/next/no-img-element -- an inline data URL, or the public cover
                <img src={still} alt="" aria-hidden decoding="async" className={cn(BLUR_COVER, look)} />
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
