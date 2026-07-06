"use client";

import { useEffect, useRef, useState } from "react";

import { FadeImage } from "@/features/ui/fade-image";
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
 */
export function MediaCarousel({
  items,
  onExpand,
  onExpandItem,
  className,
}: {
  items: CarouselMedia[];
  onExpand?: () => void;
  /** Preferred over onExpand when set — receives the tapped slide. */
  onExpandItem?: (index: number, item: CarouselMedia) => void;
  className?: string;
}) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(0);
  const raf = useRef(0);

  const onScroll = () => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const el = scroller.current;
      if (!el || el.clientWidth === 0) return;
      setIndex(Math.max(0, Math.min(items.length - 1, Math.round(el.scrollLeft / el.clientWidth))));
    });
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  return (
    <div className={cn("relative overflow-hidden bg-black", className)}>
      <div
        ref={scroller}
        onScroll={onScroll}
        data-hscroll
        className="flex aspect-[4/5] snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ touchAction: "pan-x" }}
      >
        {items.map((m, i) => (
          <div key={i} className="relative h-full w-full shrink-0 snap-center">
            {/* blurred fill behind the letterbox */}
            {(m.thumbnailUrl ?? (m.kind === "image" ? m.url : null)) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={(m.thumbnailUrl ?? m.url)!}
                alt=""
                aria-hidden
                loading="lazy"
                decoding="async"
                className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-2xl"
              />
            ) : null}
            {m.kind === "video" ? (
              <CarouselVideo src={m.url} poster={m.thumbnailUrl} onExpand={onExpandItem ? () => onExpandItem(i, m) : onExpand} />
            ) : (
              <button
                type="button"
                onClick={onExpandItem ? () => onExpandItem(i, m) : onExpand}
                aria-label="Open photo"
                className="absolute inset-0"
              >
                <FadeImage src={m.url} alt="" fill sizes="(max-width: 768px) 100vw, 640px" className="object-contain" loading={i < 2 ? "eager" : "lazy"} />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* page counter chip */}
      <span className="pointer-events-none absolute right-2.5 top-2.5 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-white backdrop-blur">
        {index + 1}/{items.length}
      </span>

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
function CarouselVideo({ src, poster, onExpand }: { src: string; poster: string | null; onExpand?: () => void }) {
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
    <button type="button" onClick={onExpand} aria-label="Watch video" className="absolute inset-0">
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
    </button>
  );
}
