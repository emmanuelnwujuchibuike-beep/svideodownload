"use client";

import { AudioLines, ChevronLeft, ChevronRight, Clapperboard, History, ImagePlus, Mic, Pause, Play, Sparkles, Wand2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { slideHref, type ShowcaseSlide, type ShowcaseTarget } from "@/lib/ai/showcase/slides";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE SHOWCASE CAROUSEL — the welcome page's "what Frenz AI makes"
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Brief A "SHOWCASE / CAROUSEL", point by point:
 *
 *   · advances every 3 s ........................... ADVANCE_MS, one setTimeout
 *   · swipe / scroll by hand ....................... native CSS scroll-snap
 *   · touch, wheel, key, focus or hover pauses it .. `hold()` / `focused`
 *   · resumes after 6 s idle ....................... RESUME_MS
 *   · stops on a hidden tab ........................ visibilitychange
 *   · reduced motion: no autoplay, no smooth scroll  matchMedia
 *   · no package, no polling ....................... ~this file
 *   · first image priority, the rest lazy .......... `eager` + fetchpriority
 *
 * Two things beyond the list, both to keep it cheap and usable:
 *
 *   · it also stops when the carousel is OFF SCREEN (IntersectionObserver), so
 *     a member reading the bottom of the page is not paying for a timer and a
 *     smooth scroll every 3 s they cannot see;
 *   · it has a pause button. Content that moves on its own for more than five
 *     seconds needs one (WCAG 2.2.2), and pausing on focus alone does not help
 *     somebody who is reading.
 *
 * The slides are props, baked into the HTML by the server
 * (lib/ai/showcase/server.ts). This component never fetches anything.
 */

const ADVANCE_MS = 3000;
const RESUME_MS = 6000;

const TARGET_ICON: Record<ShowcaseTarget, typeof Sparkles> = {
  explore: Wand2,
  "text-to-video": Sparkles,
  "image-to-video": ImagePlus,
  "lip-sync": Clapperboard,
  "text-to-audio": AudioLines,
  "voice-cloning": Mic,
  history: History,
};

export function AiShowcase({
  slides,
  base,
  className,
}: {
  slides: ShowcaseSlide[];
  /** The door's base path — "/ai" or "/studio/ai". */
  base: string;
  className?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  const resumeRef = useRef<number | undefined>(undefined);
  const [active, setActive] = useState(0);
  const [held, setHeld] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [paused, setPaused] = useState(false);
  const [onScreen, setOnScreen] = useState(false);
  const [tabVisible, setTabVisible] = useState(true);
  const [reduced, setReduced] = useState(false);
  const count = slides.length;

  /* Interaction holds autoplay, and every new interaction restarts the 6 s. */
  const hold = useCallback(() => {
    setHeld(true);
    window.clearTimeout(resumeRef.current);
    resumeRef.current = window.setTimeout(() => setHeld(false), RESUME_MS);
  }, []);

  useEffect(() => () => window.clearTimeout(resumeRef.current), []);

  /* Environment: reduced motion, tab visibility, on-screen. All event-driven. */
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMq = () => setReduced(mq.matches);
    onMq();
    mq.addEventListener("change", onMq);
    const onVis = () => setTabVisible(document.visibilityState === "visible");
    onVis();
    document.addEventListener("visibilitychange", onVis);
    let io: IntersectionObserver | undefined;
    if (rootRef.current && "IntersectionObserver" in window) {
      io = new IntersectionObserver(([e]) => setOnScreen(!!e?.isIntersecting), { threshold: 0.35 });
      io.observe(rootRef.current);
    } else {
      setOnScreen(true);
    }
    return () => {
      mq.removeEventListener("change", onMq);
      document.removeEventListener("visibilitychange", onVis);
      io?.disconnect();
    };
  }, []);

  /* Which slide is showing — read from the snap, so a swipe updates the dots. */
  useEffect(() => {
    const track = trackRef.current;
    if (!track || count < 2 || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            const i = Number((e.target as HTMLElement).dataset.index);
            if (Number.isFinite(i)) setActive(i);
          }
        }
      },
      { root: track, threshold: 0.6 },
    );
    for (const el of Array.from(track.children)) io.observe(el);
    return () => io.disconnect();
  }, [count]);

  const go = useCallback(
    (i: number) => {
      const track = trackRef.current;
      const el = track?.children[i] as HTMLElement | undefined;
      if (!track || !el) return;
      // `scrollTo` on the TRACK only — `scrollIntoView` would also scroll the page.
      track.scrollTo({ left: el.offsetLeft, behavior: reduced ? "auto" : "smooth" });
      setActive(i);
    },
    [reduced],
  );

  const autoplay = count > 1 && !held && !focused && !hovered && !paused && onScreen && tabVisible && !reduced;

  useEffect(() => {
    if (!autoplay) return;
    const t = window.setTimeout(() => go((active + 1) % count), ADVANCE_MS);
    return () => window.clearTimeout(t);
  }, [autoplay, active, count, go]);

  if (count === 0) return null;

  const step = (delta: number) => {
    hold();
    go((active + delta + count) % count);
  };

  return (
    <section
      ref={rootRef}
      aria-roledescription="carousel"
      aria-label="What Frenz AI makes"
      className={cn("relative", className)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setFocused(false);
          hold();
        }
      }}
      onPointerEnter={(e) => e.pointerType === "mouse" && setHovered(true)}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") {
          setHovered(false);
          hold();
        }
      }}
    >
      <div
        ref={trackRef}
        className="ai-showcase-track relative rounded-[1.25rem]"
        aria-live={autoplay ? "off" : "polite"}
        onPointerDown={hold}
        onWheel={hold}
        onTouchStart={hold}
        onKeyDown={hold}
      >
        {slides.map((s, i) => (
          <SlideCard key={s.id} slide={s} index={i} count={count} href={slideHref(base, s.target)} />
        ))}
      </div>

      {count > 1 ? (
        <div className="mt-3 flex items-center justify-center gap-1">
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label="Previous slide"
            className="hidden h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground sm:flex"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <div className="flex items-center">
            {slides.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  hold();
                  go(i);
                }}
                aria-label={`Show slide ${i + 1} of ${count}`}
                aria-current={i === active ? "true" : undefined}
                className="flex h-7 w-6 items-center justify-center"
              >
                <span
                  className={cn(
                    "block h-1.5 rounded-full transition-colors",
                    i === active ? "w-4 bg-primary" : "w-1.5 bg-foreground/20",
                  )}
                />
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => step(1)}
            aria-label="Next slide"
            className="hidden h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground sm:flex"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
          {!reduced ? (
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              aria-label={paused ? "Play the showcase" : "Pause the showcase"}
              aria-pressed={paused}
              className="ml-1 flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
            >
              {paused ? <Play className="h-3.5 w-3.5" aria-hidden /> : <Pause className="h-3.5 w-3.5" aria-hidden />}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/**
 * One slide. Also the admin editor's LIVE PREVIEW (features/admin/ai-showcase-editor.tsx)
 * — the same component, so what the admin sees is exactly what ships.
 */
export function SlideCard({
  slide,
  index,
  count,
  href,
  preview,
}: {
  slide: ShowcaseSlide;
  index: number;
  count: number;
  href: string;
  /** Admin preview: no navigation, no gating. */
  preview?: boolean;
}) {
  const Icon = TARGET_ICON[slide.target];
  const first = index === 0;
  const body = (
    <>
      {slide.image ? (
        // A plain <img> on purpose: the two copies are already sized webp on a
        // CDN, so the Vercel image optimizer would only bill a second encode.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={slide.image.sm}
          srcSet={`${slide.image.sm} 720w, ${slide.image.lg} 1280w`}
          sizes="(min-width: 768px) 720px, 100vw"
          width={slide.image.width}
          height={slide.image.height}
          alt={slide.alt}
          loading={first ? "eager" : "lazy"}
          fetchPriority={first ? "high" : "low"}
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <Icon className="absolute -right-3 -top-3 h-32 w-32 text-white/[0.09] sm:h-40 sm:w-40" strokeWidth={1.25} aria-hidden />
      )}
      {/* The scrim: text must stay readable on ANY uploaded image. */}
      <span className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent" aria-hidden />

      {slide.chip ? (
        <span className="absolute left-3.5 top-3.5 inline-flex items-center gap-1.5 rounded-full bg-black/25 px-2.5 py-1 text-[11.5px] font-semibold text-white ring-1 ring-inset ring-white/25 sm:left-4 sm:top-4">
          <Icon className="h-3 w-3" aria-hidden />
          {slide.chip}
        </span>
      ) : null}

      <span className="absolute inset-x-0 bottom-0 block p-4 sm:p-5">
        <span className="font-brand line-clamp-2 text-[1.5rem] font-bold leading-[1.08] text-white sm:text-[1.85rem]">
          {slide.title}
          {slide.highlight ? (
            <>
              {slide.title ? " " : null}
              <span className="bg-gradient-to-r from-sky-300 via-indigo-200 to-violet-300 bg-clip-text text-transparent">
                {slide.highlight}
              </span>
            </>
          ) : null}
        </span>
        {slide.description ? (
          <span className="mt-1.5 line-clamp-2 max-w-[38ch] text-[13px] leading-snug text-white/85 sm:text-[14px]">
            {slide.description}
          </span>
        ) : null}
      </span>
    </>
  );

  const frame = cn(
    "ai-showcase-art relative block aspect-[16/10] overflow-hidden rounded-[1.25rem] ring-1 ring-inset ring-black/[0.06] sm:aspect-[2/1]",
    "outline-none focus-visible:ring-2 focus-visible:ring-ring",
  );

  return (
    <div role="group" aria-roledescription="slide" aria-label={`${index + 1} of ${count}`} data-index={index}>
      {preview ? (
        <div className={frame}>{body}</div>
      ) : (
        /*
          🔴 prefetch={false} — measured 2026-10-05. With the default, every
          slide the AUTOPLAY scrolled into view prefetched its tool's RSC
          payload (`/ai/image-to-video?_rsc=…`, `/ai/lip-sync?_rsc=…`): one to
          three server renders per idle visit, plus the JS chunks they pull in,
          that nobody asked for — and for a guest
          a render of a page that refuses them. Median idle requests (3 runs,
          member, 8 s window): 0 on the old page, 9 on this one with prefetch on.
          A tap still navigates normally.
        */
        <Link href={href} prefetch={false} className={frame} data-ai-members="">
          {body}
        </Link>
      )}
    </div>
  );
}

