"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Maximize2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { WowSolid } from "@/components/brand/wow-icon";
import { FadeImage } from "@/features/ui/fade-image";
import { prefetchImage } from "@/lib/media/prefetch-image";
import { cn } from "@/lib/utils";

export interface CarouselMedia {
  url: string;
  kind: "image" | "video";
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
}

/**
 * The feed album carousel — native scroll-snap (momentum + rubber-band for
 * free, zero JS on the hot path), one full-width slide per item, page counter
 * chip + dots per the design. Media is never cropped: slides letterbox over a
 * blurred backdrop. Videos autoplay muted only while the slide is on screen;
 * off-screen media lazy-loads.
 *
 * Gesture contract (owner spec): the carousel slides SIDEWAYS ONLY —
 * `touch-action: pan-x` means a drag starting on it never scrolls the page
 * vertically or wobbles diagonally. `data-hscroll` tells ancestor swipe
 * readers (the feed's For You/Following tab switcher) to ignore gestures
 * that begin here, so swiping between slides never switches feed tabs.
 *
 * Tap handling deliberately does NOT use a plain `onClick` on the slides:
 * inside a native horizontally-scrollable, snap-mandatory container the
 * browser delays/suppresses `click` until it's sure the touch wasn't a scroll
 * (the same tap-vs-scroll disambiguation every mobile browser does), which
 * read as "opening is slow". Pointer events + a small movement tolerance
 * (the same pattern FeedVideo/FeedImage already use) react the instant the
 * finger lifts instead, and double-tap-to-Wow (Instagram/TikTok-style, never
 * un-likes) rides the same gesture.
 */
export function MediaCarousel({
  items,
  onExpand,
  onExpandItem,
  liked,
  onDoubleTapLike,
  className,
}: {
  items: CarouselMedia[];
  onExpand?: () => void;
  /** Preferred over onExpand when set — receives the tapped slide. */
  onExpandItem?: (index: number, item: CarouselMedia) => void;
  /** Already Wowed — hides the "Double-tap to Wow" hint. */
  liked?: boolean;
  onDoubleTapLike?: () => void;
  className?: string;
}) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(0);
  const raf = useRef(0);
  const [burst, setBurst] = useState(0);
  const lastTap = useRef(0);
  const startPt = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);

  // Sequential/priority loading: an album with many photos was firing N
  // simultaneous image requests the instant it mounted, so the ONE slide
  // actually being viewed competed with every other slide for the browser's
  // per-host connection cap and was slow to appear. Only the current slide +
  // its immediate neighbours ever mount a real <img>/<video> src; everything
  // else stays an unmounted placeholder until scrolled near, so slides load
  // one at a time, in order, as you swipe through them. Once a slide has
  // loaded it stays loaded (sticky — never re-fetches on scrolling back).
  const [unlocked, setUnlocked] = useState<Set<number>>(() => new Set([0, 1]));
  useEffect(() => {
    setUnlocked((prev) => {
      if (prev.has(index) && prev.has(Math.max(0, index - 1)) && prev.has(Math.min(items.length - 1, index + 1))) return prev;
      const next = new Set(prev);
      next.add(index);
      if (index > 0) next.add(index - 1);
      if (index < items.length - 1) next.add(index + 1);
      return next;
    });
  }, [index, items.length]);
  // Combine the sticky set with the live neighbour window directly (not just
  // the state above) so the slide you're actually swiping onto never has a
  // one-render lag waiting for the effect to catch up.
  const isNear = (i: number) => Math.abs(i - index) <= 1;

  // The thumbnail above only ever fetches next/image's resized variant — a
  // different URL than the RAW one the fullscreen album viewer requests via
  // a plain `<img src>`. Warm the raw bytes for every newly-unlocked photo
  // slide so opening the viewer on any slide you've swiped near is an
  // instant cache hit instead of a fresh fetch (see prefetch-image.ts).
  useEffect(() => {
    for (const i of unlocked) {
      const m = items[i];
      if (m?.kind === "image") prefetchImage(m.url);
    }
  }, [unlocked, items]);

  const onSlidePointerDown = (e: React.PointerEvent) => {
    startPt.current = { x: e.clientX, y: e.clientY };
    moved.current = false;
    // Same tap-time head start as FeedImage — warms whichever fullscreen
    // viewer this slide might open (image album → ImageViewer, video album →
    // ReelsFeed; cheap to request both, only one is ever actually used).
    void import("@/features/feed/image-viewer");
    void import("@/features/reels/reels-feed");
  };
  const onSlidePointerMove = (e: React.PointerEvent) => {
    if (!startPt.current || moved.current) return;
    if (Math.abs(e.clientX - startPt.current.x) > 12 || Math.abs(e.clientY - startPt.current.y) > 12) moved.current = true;
  };
  // 2026-07-15 (owner: opening should be instant, zero wait) — see
  // FeedImage's identical fix/comment. A tap opens the fullscreen viewer
  // immediately, no longer held back waiting to see if a second tap
  // follows; a genuinely fast second tap additionally fires the Wow burst
  // as a bonus, never gating or delaying the open.
  const DBLTAP_WINDOW = 220;
  const onSlideTap = (i: number, m: CarouselMedia) => () => {
    if (moved.current) return;
    const now = Date.now();
    if (now - lastTap.current < DBLTAP_WINDOW) {
      lastTap.current = 0;
      setBurst((b) => b + 1);
      onDoubleTapLike?.();
      return;
    }
    lastTap.current = now;
    if (onExpandItem) onExpandItem(i, m);
    else onExpand?.();
  };

  const onScroll = () => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const el = scroller.current;
      if (!el || el.clientWidth === 0) return;
      setIndex(Math.max(0, Math.min(items.length - 1, Math.round(el.scrollLeft / el.clientWidth))));
    });
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  // Mouse wheels and trackpads fire `wheel` events, not touch events — CSS
  // (touch-action, overscroll-behavior) has no say over them at all. Left
  // alone, a horizontally-scrollable element STILL claims a vertical wheel
  // gesture for itself (a real, long-standing browser behavior — "this box
  // can scroll, so route the wheel input here"), which is exactly why
  // hovering a multi-media post and scrolling froze the page even after
  // overscroll-behavior-y was fixed: that property only governs chaining
  // AFTER a scroll boundary is hit, not this initial axis routing. Redirect
  // vertical-dominant wheel input to the page ourselves; a horizontal
  // trackpad swipe (deltaX dominant) still scrolls the carousel natively.
  // Must be a real (non-passive) listener — React's synthetic onWheel is
  // passive by default, so preventDefault() inside it is silently ignored.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheelNative = (e: WheelEvent) => {
      if (e.ctrlKey) return; // pinch-zoom gesture — never intercept
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        // `behavior: "auto"` is NOT optional here — globals.css sets a global
        // `html { scroll-behavior: smooth }` (for anchor-link navigation), which
        // an unqualified scrollBy() silently inherits. A mouse wheel fires many
        // deltaY events per second, so every tick was queuing/restarting a NEW
        // smooth-scroll animation on top of the still-running previous one —
        // that compounding is exactly what read as "scrolls very slow and
        // hangs" over a multi-photo post. Forcing "auto" makes wheel input
        // track the cursor 1:1, like native scrolling, regardless of that
        // page-wide smooth-scroll default.
        window.scrollBy({ top: e.deltaY, left: 0, behavior: "auto" });
      }
    };
    el.addEventListener("wheel", onWheelNative, { passive: false });
    return () => el.removeEventListener("wheel", onWheelNative);
  }, []);

  return (
    <div className={cn("relative overflow-hidden bg-black", className)}>
      <div
        ref={scroller}
        onScroll={onScroll}
        data-hscroll
        className={cn(
          // overflow-x-auto alone implicitly sets overflow-y to auto too (a
          // CSS quirk) — overflow-y-hidden makes the "sideways only, never up
          // or down" contract explicit rather than relying on touch-action alone.
          "flex snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          "aspect-[4/5]",
        )}
        // MUST allow BOTH axes. `pan-x` ALONE was the bug: it tells the browser
        // "only horizontal panning is possible for touches that start here", so
        // a vertical swipe beginning on an album carousel scrolled NOTHING — the
        // page couldn't move and the post felt frozen (photos AND video albums).
        // With `pan-x pan-y` the browser direction-locks: a horizontal drag
        // scrolls the carousel natively, a vertical drag chains to the page
        // (the scroller has no vertical overflow, so it hands the gesture up).
        // Back/forward-nav on horizontal overscroll is still blocked by the
        // `overscroll-x-contain` above; single feed videos already do exactly
        // this (they use `touch-pan-y`), which is why THEY always scrolled fine.
        style={{ touchAction: "pan-x pan-y" }}
      >
        {items.map((m, i) => {
          const loaded = isNear(i) || unlocked.has(i);
          return (
            <div key={i} className="relative h-full w-full shrink-0 snap-center">
              {!loaded ? (
                <div className="absolute inset-0 bg-neutral-900" />
              ) : (
                <>
                  {/* blurred fill behind the letterbox */}
                  {(m.thumbnailUrl ?? (m.kind === "image" ? m.url : null)) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={(m.thumbnailUrl ?? m.url)!}
                      alt=""
                      aria-hidden
                      loading="eager"
                      decoding="async"
                      className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-2xl"
                    />
                  ) : null}
                  {m.kind === "video" ? (
                    <CarouselVideo
                      src={m.url}
                      poster={m.thumbnailUrl}
                      onPointerDown={onSlidePointerDown}
                      onPointerMove={onSlidePointerMove}
                      onPointerUp={onSlideTap(i, m)}
                    />
                  ) : (
                    <div
                      role="button"
                      aria-label="Open photo"
                      // No press-scale (2026-07-15, owner: images shouldn't
                      // move under touch/press-hold) — see FeedImage's
                      // identical fix. cursor-default overrides Tailwind
                      // Preflight's `[role="button"]{cursor:pointer}` — a
                      // mouse-pointer hand icon spanning the ENTIRE slide
                      // read as "this is grabbing my scroll" even though the
                      // wheel redirect above already made it scroll
                      // correctly; a plain arrow matches every other
                      // (single-media) feed post.
                      className="absolute inset-0 cursor-default"
                      onPointerDown={onSlidePointerDown}
                      onPointerMove={onSlidePointerMove}
                      onPointerUp={onSlideTap(i, m)}
                    >
                      <FadeImage src={m.url} alt="" fill sizes="(max-width: 768px) 100vw, 640px" className="object-contain" loading="eager" />
                    </div>
                  )}
                </>
              )}
              {/* Not-yet-loaded slides still need to be tappable so a fast
                  swipe-then-tap (or a strong fling landing several slides
                  away in one native scroll) still responds. */}
              {!loaded ? (
                <div
                  role="button"
                  aria-label="Open"
                  className="absolute inset-0 cursor-default"
                  onPointerDown={onSlidePointerDown}
                  onPointerMove={onSlidePointerMove}
                  onPointerUp={onSlideTap(i, m)}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Double-tap Wow burst — centered, same reliable pattern FeedVideo/
          FeedImage use (not tap-position-tracked). */}
      <AnimatePresence>
        {burst > 0 ? (
          <span className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <motion.span
              key={burst}
              initial={{ opacity: 0, scale: 0.4 }}
              animate={{ opacity: [0, 1, 1, 0], scale: [0.4, 1.3, 1.1, 1.5] }}
              transition={{ duration: 0.9, ease: "easeOut", times: [0, 0.2, 0.6, 1] }}
              className="drop-shadow-[0_2px_10px_rgba(0,0,0,0.5)]"
            >
              <WowSolid className="h-24 w-24" />
            </motion.span>
          </span>
        ) : null}
      </AnimatePresence>

      {/* Wow hint */}
      <span className={cn("pointer-events-none absolute bottom-2 left-2.5 z-10 rounded-full bg-black/40 px-2 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur", liked && "hidden")}>
        Double-tap to Wow
      </span>

      {/* page counter chip */}
      <span className="pointer-events-none absolute right-2.5 top-[0.625rem] rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-white backdrop-blur">
        {index + 1}/{items.length}
      </span>

      {/* Expand — opens the current slide in the real fullscreen viewer
          (reel for video, the full image viewer for photos), same as tapping
          the slide itself, instead of a separate lesser in-place enlarge. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          const current = items[index];
          if (!current) return;
          if (onExpandItem) onExpandItem(index, current);
          else onExpand?.();
        }}
        aria-label="Open in fullscreen"
        className="absolute bottom-2.5 right-2.5 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md transition hover:bg-black/65"
      >
        <Maximize2 className="h-4 w-4" />
      </button>

      {/* dots */}
      <div className="pointer-events-none absolute inset-x-0 bottom-2 flex items-center justify-center gap-1.5">
        {items.map((_, i) => (
          <span
            key={i}
            className={cn(
              "h-1.5 rounded-full transition-all duration-300",
              i === index ? "w-4 bg-white" : "w-1.5 bg-white/45",
            )}
          />
        ))}
      </div>
    </div>
  );
}

/** In-view autoplaying slide video — muted, looping, paused off-screen. */
function CarouselVideo({
  src,
  poster,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  src: string;
  poster: string | null;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.isIntersecting) v.play().catch(() => {});
        else v.pause();
      },
      { threshold: 0.55 },
    );
    obs.observe(v);
    return () => {
      obs.disconnect();
      v.pause();
    };
  }, []);
  return (
    <div
      role="button"
      aria-label="Watch video"
      className="absolute inset-0 cursor-default"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        ref={ref}
        src={src}
        poster={poster ?? undefined}
        muted
        loop
        playsInline
        preload="metadata"
        className="h-full w-full object-contain"
      />
    </div>
  );
}
