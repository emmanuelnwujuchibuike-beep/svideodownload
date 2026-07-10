"use client";

import { AnimatePresence, motion } from "framer-motion";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { WowSolid } from "@/components/brand/wow-icon";
import { FadeImage } from "@/features/ui/fade-image";
import { prefetchImage } from "@/lib/media/prefetch-image";
import { cn } from "@/lib/utils";

/**
 * Inline feed image — shown full-size (like a video), with Instagram-style
 * double-tap-to-like (a big heart pops), while a single tap opens the full
 * viewer (with comments). Never crops awkwardly: the image sits on a soft
 * backdrop and shows in full.
 */
export function FeedImage({
  src,
  alt,
  width,
  height,
  liked,
  onDoubleTapLike,
  onExpand,
  className,
}: {
  src: string;
  alt: string;
  /** Natural pixel size — when known, the photo renders via next/image (AVIF/WebP). */
  width?: number;
  height?: number;
  liked: boolean;
  onDoubleTapLike: () => void;
  onExpand: () => void;
  className?: string;
}) {
  const hasDims = !!width && !!height && width > 0 && height > 0;
  const lastTap = useRef(0);
  const singleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPt = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);
  const [burst, setBurst] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Warm the RAW image URL well before the card is actually tapped (a much
  // wider margin than the "is it visible yet" threshold below, since the
  // goal is "already cached by the time you'd realistically tap it", not
  // just "started loading as it appears") — see prefetch-image.ts for why
  // this is the fix for the fullscreen viewer's real open-delay, not the
  // inline thumbnail's own (already-optimized) loading.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          prefetchImage(src);
          obs.disconnect();
        }
      },
      { rootMargin: "1200px 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [src]);

  const onPointerDown = (e: React.PointerEvent) => {
    startPt.current = { x: e.clientX, y: e.clientY };
    moved.current = false;
    // Kick the fullscreen viewer's chunk off at the very first touch — not
    // idle-time-after-mount, not tap-up — so it's had the longest possible
    // head start by the time a real single tap resolves below. A no-op if
    // it's already cached (Next dedupes identical dynamic-import specifiers
    // with whatever else in the app requested the same module).
    void import("@/features/feed/image-viewer");
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!startPt.current || moved.current) return;
    if (Math.abs(e.clientX - startPt.current.x) > 12 || Math.abs(e.clientY - startPt.current.y) > 12) moved.current = true;
  };
  // Single-tap-open vs. double-tap-to-Wow disambiguation: DBLTAP_WINDOW and
  // OPEN_DELAY are kept equal so the open timer can never fire before a
  // genuine second tap has a chance to cancel it (was 300/280 — tightened to
  // shave real latency off every single tap without reopening that gap).
  const DBLTAP_WINDOW = 220;
  const onPointerUp = () => {
    if (moved.current) return;
    const now = Date.now();
    if (now - lastTap.current < DBLTAP_WINDOW) {
      // Double tap → like.
      if (singleTimer.current) clearTimeout(singleTimer.current);
      lastTap.current = 0;
      setBurst((b) => b + 1);
      onDoubleTapLike();
      return;
    }
    lastTap.current = now;
    if (singleTimer.current) clearTimeout(singleTimer.current);
    singleTimer.current = setTimeout(() => onExpand(), DBLTAP_WINDOW);
  };

  return (
    <div
      ref={containerRef}
      // Subtle press feedback (Part 10's "lift on touch" ask) — safe here
      // since FeedImage has no nested interactive buttons of its own to
      // double up with (unlike a whole feed card, which has its action bar).
      className={cn("relative flex items-center justify-center overflow-hidden bg-neutral-950 transition-transform duration-150 active:scale-[0.985]", className)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* Blurred backdrop fills any letterbox space around the contained image.
          Deliberately a separate, tiny (16px) optimized fetch — not the full-res
          `src` — so it downloads near-instantly instead of duplicating the
          full-quality image the foreground already requests (Loading Architecture:
          never load full-resolution images just to blur them). */}
      <Image
        src={src}
        alt=""
        aria-hidden
        width={16}
        height={16}
        quality={20}
        className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-30 blur-2xl"
      />
      {/* Foreground: next/image (AVIF/WebP + right-sized) when the natural size is
          known; otherwise a plain lazy <img> at natural aspect (older posts). */}
      {hasDims ? (
        <FadeImage
          src={src}
          alt={alt}
          width={width}
          height={height}
          sizes="(max-width: 768px) 100vw, 640px"
          className="relative h-auto max-h-[80vh] w-auto max-w-full object-contain"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} loading="lazy" className="relative max-h-[80vh] w-auto max-w-full object-contain" />
      )}

      {/* Double-tap Wow burst */}
      <AnimatePresence>
        {burst > 0 ? (
          <motion.span
            key={burst}
            initial={{ opacity: 0, scale: 0.4 }}
            animate={{ opacity: [0, 1, 1, 0], scale: [0.4, 1.15, 1, 1.2] }}
            transition={{ duration: 0.8, times: [0, 0.2, 0.7, 1] }}
            className="pointer-events-none absolute drop-shadow-[0_2px_10px_rgba(0,0,0,0.5)]"
          >
            <WowSolid className="h-24 w-24" />
          </motion.span>
        ) : null}
      </AnimatePresence>

      {/* Wow hint */}
      <span className={cn("pointer-events-none absolute bottom-2 left-2.5 rounded-full bg-black/40 px-2 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur", liked && "hidden")}>
        Double-tap to Wow
      </span>
    </div>
  );
}
