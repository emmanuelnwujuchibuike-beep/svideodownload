"use client";

import { ImageOff } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { FadeImage } from "@/features/ui/fade-image";
import { fireWowFeedback, WowBurst } from "@/features/ui/wow-burst";
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
  children,
  priority = false,
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
  /**
   * Overlay content (e.g. a views-count badge) positioned relative to THIS
   * component's own box — not the caller's outer wrapper. 2026-08-17: a
   * views badge rendered as a SIBLING in feed-post-card.tsx, absolutely
   * positioned against that outer wrapper, floated away from the actual
   * photo once this box could be narrower than its wrapper (the max-h cap
   * centering a tall photo). Passing it in here instead means it's
   * always anchored to the real, possibly-narrower media box.
   */
  children?: React.ReactNode;
  /**
   * 🔴 True only for the feed's first card (owner, 2026-08-18: "make the
   * feed page have the same LCP as landing" — measured via Playwright:
   * landing's LCP image resolves in ~200ms through next/image's optimizer,
   * feed's took ~1.8s because EVERY card, including whichever one is
   * actually the LCP element, was hardcoded to `fetchPriority="low"`. That
   * hint tells the browser to schedule the fetch behind everything else on
   * the page — correct for the 2nd+ card, actively harmful for the 1st.
   * Threaded down from feed-post-card.tsx rather than guessed here, since
   * this component has no way to know its own position in the stream.
   */
  priority?: boolean;
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
      fireWowFeedback();
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
    🔴 SETTLED 2026-08-17 (see `lib/media/aspect.ts`'s matching note for the
    full owner-quote history — several revisions same day). Final shape:
    `ratio` is the photo's real, fully unclamped shape (no floor, no
    ceiling) — full card width always, `object-contain` never crops, and the
    generous `max-h-[85vh]` below is a true last-resort ceiling for a
    genuinely pathological upload, not a routine lever. For any realistic
    phone-shot photo this never triggers, so width and the blurred backdrop
    below are basically moot in practice — the box's shape simply IS the
    photo's own true shape.
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
        // 🔴 FIXED LEFT LINE, FLEXIBLE RIGHT (owner, 2026-08-18, superseding
        // the "don't restyle this box" note below — that call was made before
        // the owner sent three real Twitter screenshots showing every post's
        // media sharing ONE fixed left edge, with only the RIGHT edge varying
        // by each image's own width: "the left is fixed and doesnt cross the
        // line... some images can expand to the way end of right leaving only
        // 1.5 or 1 padding, but the left is fixed"). `mx-auto` centers a
        // narrower-than-full-width box, which puts slack on BOTH sides
        // instead of only the right — exactly what the screenshots rule out.
        // `mr-auto` puts all the slack on the right; `w-fit` (not the
        // previously-assumed-safe default) is what stops this box from
        // silently staying full-width once centering was the only thing
        // holding it there — the same "wrapper vs. shrunk child" black-gap
        // mechanism already fixed on FeedVideo's matching wrapper.
        "relative mr-auto flex w-fit max-w-full max-h-[85vh] items-center justify-center overflow-hidden rounded-2xl bg-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset",
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
          never load full-resolution images just to blur them).
          `!broken`/`onError` (owner, 2026-08-17: "the feed should never show
          this question mark and a white line when loading delays or bad
          network") — a failed fetch on this tiny request otherwise falls
          through to the browser's own broken-image glyph same as the
          foreground would; sharing the foreground's `broken` state means one
          failure hides both instead of the backdrop lingering broken behind
          the (already-handled) foreground placeholder. */}
      {!broken ? (
        <Image
          src={src}
          alt=""
          aria-hidden
          width={16}
          height={16}
          quality={20}
          className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-30 blur-2xl"
          onError={() => setBroken(true)}
        />
      ) : null}
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
          // above, the photo's own TRUE shape, unclamped) is what sizes this
          // image now — `object-contain` is a no-op for a short/wide photo
          // (box already matches it exactly) and only shrinks (never crops)
          // a tall photo once the `max-h-[85vh]` cap narrows the box below
          // the photo's own preferred height.
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
          fetchPriority={priority ? "high" : "low"}
          className="object-contain"
          onError={() => setBroken(true)}
        />
      ) : (
        // 🔴 STILL next/image, EVEN WITHOUT A KNOWN RATIO (owner, 2026-08-18:
        // measured /feed's LCP against landing's — landing's hero resolves
        // in ~200ms through next/image's optimizer; a feed post missing
        // stored dimensions was serving its ORIGINAL, unresized upload
        // (217KB for the one actually measured) through a plain `<img>`,
        // which is most of where the gap came from). No aspect-ratio means
        // `fill` has nothing to size against, but `width`/`height` here are
        // only a HINT for the optimizer's own srcset math, not the display
        // size — `h-auto w-auto` + `object-contain` below (same CSS the
        // plain `<img>` this replaces already used) still lets the browser
        // render the photo at its own true intrinsic shape once it loads,
        // same as before. What changes is that the bytes on the wire are now
        // compressed/re-encoded (AVIF/WebP) instead of the raw original.
        <Image
          src={src}
          alt={alt}
          width={1600}
          height={1600}
          // Without this, next/image assumes the image displays at its full
          // hinted width (1600px) on every viewport and requests the nearest
          // breakpoint above that (1920px) regardless of how small the
          // actual rendered box is — the same `sizes` the FadeImage branch
          // above already uses, so a phone gets a phone-sized file.
          sizes="(max-width: 768px) 100vw, 640px"
          loading="eager"
          fetchPriority={priority ? "high" : "low"}
          className="relative h-auto max-h-[80vh] w-auto max-w-full object-contain"
          onError={() => setBroken(true)}
        />
      )}

      {/* Double-tap Wow burst — shared across every media surface now (owner,
          2026-08-18: "reels, feed, multi post, single post, video post
          should use one wow animation and haptic sound"), portaled out of
          this box's own `overflow-hidden` so it isn't clipped at the edge. */}
      <WowBurst burstKey={burst} anchorRef={containerRef} />

      {children}
    </div>
  );
}
