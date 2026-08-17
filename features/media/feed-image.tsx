"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ImageOff } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { WowSolid } from "@/components/brand/wow-icon";
import { FadeImage } from "@/features/ui/fade-image";
import { useTapOrDoubleTap } from "@/lib/hooks/use-tap-or-double-tap";
import { clampFeedRatio } from "@/lib/media/aspect";
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
  const [burst, setBurst] = useState(0);
  // A 404/CORS/offline failure otherwise falls through to the browser's own
  // default broken-image icon — jarring and off-brand. Reset SYNCHRONOUSLY
  // during render (not a post-paint useEffect) when `src` changes — a
  // recycled feed item (virtualization, a retried fetch with a refreshed
  // signed URL) must not render one extra frame of the stale placeholder
  // before the new image even starts loading.
  const [broken, setBroken] = useState(false);
  const [lastSrc, setLastSrc] = useState(src);
  if (src !== lastSrc) {
    setLastSrc(src);
    setBroken(false);
  }
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

  /*
    🔴 REVERSED 2026-08-17 (owner spec: "A double tap MUST NOT open the Reels
    viewer" — "Most important acceptance criterion", stated repeatedly).

    The 2026-07-15 entry directly below is the decision this replaces: a
    single tap used to open the viewer IMMEDIATELY, with a fast second tap
    ALSO firing the Wow burst as a bonus afterward — meaning a genuine double
    tap opened the viewer AND liked, exactly the sequence the owner has now
    named explicitly unacceptable. `useTapOrDoubleTap` (shared with
    MediaCarousel below) restores the hold-briefly-in-case-a-second-tap-
    follows pattern `FeedVideo` already used for this same reason, at a short
    280ms default rather than reverting to some slower original value — a
    real but small latency cost, deliberately traded for correctness per
    today's explicit, repeated instruction.

    2026-07-15 (owner: opening should be instant, zero wait) — a single tap
    used to wait out a 220ms window before opening, purely to see whether a
    SECOND tap was coming (double-tap-to-Wow) — real, felt latency on every
    single open. `ImageViewer` (the full-screen viewer this opens into)
    already has its own independent double-tap-to-like once open.
  */
  const tap = useTapOrDoubleTap({
    onTap: () => onExpand(),
    onDoubleTap: () => {
      setBurst((b) => b + 1);
      onDoubleTapLike();
    },
  });
  const onPointerDown = (e: React.PointerEvent) => {
    tap.onPointerDown(e);
    // Kick the fullscreen viewer's chunk off at the very first touch — not
    // idle-time-after-mount, not tap-up — so it's had the longest possible
    // head start by the time the delayed tap actually opens it. A no-op if
    // it's already cached (Next dedupes identical dynamic-import specifiers
    // with whatever else in the app requested the same module).
    void import("@/features/feed/image-viewer");
  };

  /*
    ── The feed's Twitter/Threads density cap (owner, 2026-08-16) ────────────
    "every long video or image should shrink on the feed like Twitter… two
    posts that will be able to show complete."

    `clampFeedRatio` is the same 4:5-tallest ceiling `FeedVideo` uses — see
    `lib/media/aspect.ts`. Applied to the CONTAINER as an explicit aspect
    ratio (not left to next/image's own intrinsic width/height sizing), which
    is what lets a portrait photo taller than 4:5 be shown SMALLER —
    letterboxed within this box via `object-contain` below — rather than
    stretching the card to the photo's true height.

    This is why the foreground switches to `fill` mode a few lines down: a
    `fill` image has no size of its own, so the container's aspect-ratio is
    what actually determines the rendered height, instead of racing it.
  */
  const ratio = hasDims ? clampFeedRatio(width, height) : null;

  return (
    <div
      ref={containerRef}
      // No press-scale here (2026-07-15, owner: "the pictures in feed move
      // when I touch it or press and hold, I want it fixed") — Part 10's
      // "lift on touch" `active:scale-[0.985]` was a deliberate press-
      // feedback treatment, but on a large feed photo any scale shift reads
      // as the image itself shifting/wobbling under a finger, not a subtle
      // press cue. The image now stays perfectly still through any touch,
      // press, or press-and-hold.
      style={ratio ? { aspectRatio: ratio } : undefined}
      className={cn(
        "relative flex items-center justify-center overflow-hidden bg-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset",
        className,
      )}
      // Keyboard access (owner spec, 2026-08-17: "Keyboard users can still
      // open media"): Enter/Space opens directly, same action as a resolved
      // single tap — no double-press analog exists for a keyboard, and Wow
      // already has its own independent, keyboard-reachable button in the
      // action row below, so nothing here is the ONLY way to reach it.
      role="button"
      tabIndex={0}
      aria-label="Open photo"
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onExpand();
      }}
      onPointerDown={onPointerDown}
      onPointerMove={tap.onPointerMove}
      onPointerUp={tap.onPointerUp}
      onPointerLeave={tap.onPointerLeave}
      onPointerCancel={tap.onPointerCancel}
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
          known; otherwise a plain lazy <img> at natural aspect (older posts).
          A load failure (404/CORS/offline) falls back to a branded placeholder
          instead of the browser's own default broken-image icon. */}
      {broken ? (
        <div className="relative flex h-48 w-full max-w-full flex-col items-center justify-center gap-2 text-muted-foreground/70">
          <ImageOff className="h-8 w-8" aria-hidden />
          <span className="text-xs font-medium">Image unavailable</span>
        </div>
      ) : ratio ? (
        // `ratio` (not `hasDims`) gates this branch: `fill` mode needs the
        // container to actually HAVE an aspect-ratio to size against, and
        // `ratio` is exactly the signal for that (it's null whenever
        // `clampFeedRatio` couldn't make sense of the stored dimensions, even
        // if `hasDims` itself looked true).
        <FadeImage
          src={src}
          alt={alt}
          // `fill`, not `width`/`height`: the CONTAINER's aspect-ratio (set
          // above, clamped to the 4:5 density cap) is what sizes this image
          // now — the image itself has no intrinsic size to contribute or to
          // fight the clamp with. `object-contain` still means a source
          // taller than the clamp is shrunk to fit, never cropped.
          fill
          sizes="(max-width: 768px) 100vw, 640px"
          // EAGER, not next/image's default lazy. The feed only mounts a card
          // once its page data has been prefetched ~3 screens ahead (SmartFeed's
          // 2400px sentinel), so by the time a card is in the DOM the viewer is
          // still screens away — loading its image right then means the bytes are
          // decoded and cached before it scrolls into view, instead of the card
          // flashing white while a just-in-time lazy fetch runs (owner, 2026-07-17:
          // "loads slowly as i scroll … the prefetch of next posts was removed").
          // `fetchPriority="low"` keeps these below-the-fold loads from ever
          // competing with the in-view LCP image, so warming ahead costs nothing
          // on the 2-second budget — the browser still fetches whatever is on
          // screen first.
          loading="eager"
          fetchPriority="low"
          className="object-contain"
          onError={() => setBroken(true)}
        />
      ) : (
        // No known dimensions (older post, pre-backfill) — the container has
        // no aspect-ratio to size itself by, so this keeps the ORIGINAL
        // intrinsic-sizing `<img>` (natural aspect, capped only by the 80vh
        // safety ceiling) rather than a `fill` image with nothing to fill.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          loading="eager"
          fetchPriority="low"
          className="relative max-h-[80vh] w-auto max-w-full object-contain"
          onError={() => setBroken(true)}
        />
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
