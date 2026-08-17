"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Play } from "lucide-react";
import { useEffect, useState } from "react";

import { WowSolid } from "@/components/brand/wow-icon";
import type { CarouselMedia } from "@/features/media/media-carousel";
import { useTapOrDoubleTap } from "@/lib/hooks/use-tap-or-double-tap";
import { prefetchImage } from "@/lib/media/prefetch-image";
import { cn } from "@/lib/utils";

/**
 * Instagram-style STATIC grid preview for a multi-item post (owner, 2026-08-17
 * redesign spec, section 9) — replaces the always-swipeable single-slide
 * MediaCarousel for the feed's INLINE rendering of 2+ item albums. Tapping any
 * cell opens the SAME full-screen viewer at that exact index via
 * `onExpandItem`, identical to what MediaCarousel already wires up — the
 * carousel component itself is untouched, so its proven swipe/prefetch/
 * gesture logic (including last session's tap-vs-double-tap fix) carries zero
 * regression risk here. This is a new, additive sibling, not a replacement.
 *
 * Layouts (spec's own ASCII diagrams): 2 = side by side; 3 = one tall cell +
 * two stacked; 4 = 2x2; 5+ = 2x2 with a "+N" overlay on the 4th cell. Every
 * layout sits inside one fixed square frame (Instagram's own convention) with
 * a 2px gap — "keep gaps extremely small and intentional."
 *
 * Videos in the grid show a static poster + play glyph, never autoplay: N
 * small clips playing simultaneously in a dense grid is exactly the
 * battery/data cost performance work elsewhere in this app exists to avoid,
 * and neither Instagram nor X autoplay their own grid thumbnails either.
 */
export function MediaGrid({
  items,
  onExpandItem,
  liked,
  onDoubleTapLike,
  className,
}: {
  items: CarouselMedia[];
  onExpandItem: (index: number, item: CarouselMedia) => void;
  /** Already Wowed — hides the "Double-tap to Wow" hint. */
  liked?: boolean;
  onDoubleTapLike?: () => void;
  className?: string;
}) {
  const visible = items.slice(0, 4);
  const overflowCount = items.length - 4;

  // Warm both possible viewer chunks + every visible thumbnail's raw bytes
  // once, on mount — same head-start MediaCarousel gives its own slides.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    for (const m of visible) {
      if (m.kind === "image") prefetchImage(m.url);
    }
    void import("@/features/feed/image-viewer");
    void import("@/features/reels/reels-feed");
  }, []);

  return (
    <div
      className={cn(
        "relative grid aspect-square grid-cols-2 gap-0.5 overflow-hidden rounded-2xl",
        // 2 items: a single row (spec's "side by side") — grid-rows-2 with
        // only 2 cells would leave the bottom half of the square empty.
        // 3+ items: two rows (2x2 frame, or the tall-left/stacked-right
        // layout for exactly 3, handled per-cell via `spanRows` below).
        visible.length === 2 ? "grid-rows-1" : "grid-rows-2",
        className,
      )}
    >
      {visible.map((m, i) => (
        <GridCell
          key={i}
          media={m}
          // The classic Instagram 3-photo layout: item 0 is a tall left
          // column spanning both rows, items 1-2 stack in the right column.
          // 2-photo posts render into the same 2x2 frame but only fill the
          // top row, which reads correctly as "side by side" without a
          // separate grid-template for that count.
          spanRows={visible.length === 3 && i === 0}
          overlayCount={overflowCount > 0 && i === 3 ? overflowCount : null}
          onTap={() => onExpandItem(i, m)}
          onDoubleTap={() => onDoubleTapLike?.()}
        />
      ))}
      {/* One hint for the whole grid, matching FeedImage/MediaCarousel's
          single-slide hint — not one per cell, which would read as noise. */}
      <span
        className={cn(
          "pointer-events-none absolute bottom-2 left-2.5 z-10 rounded-full bg-black/40 px-2 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur",
          liked && "hidden",
        )}
      >
        Double-tap to Wow
      </span>
    </div>
  );
}

function GridCell({
  media,
  spanRows,
  overlayCount,
  onTap,
  onDoubleTap,
}: {
  media: CarouselMedia;
  spanRows: boolean;
  /** Set on the last visible cell when there are more items than fit — "+N". */
  overlayCount: number | null;
  onTap: () => void;
  onDoubleTap: () => void;
}) {
  const [burst, setBurst] = useState(0);
  const tap = useTapOrDoubleTap({
    onTap,
    onDoubleTap: () => {
      setBurst((b) => b + 1);
      onDoubleTap();
    },
  });
  const thumb = media.thumbnailUrl ?? (media.kind === "image" ? media.url : null);

  return (
    <div
      role="button"
      aria-label={media.kind === "video" ? "Watch video" : "Open photo"}
      tabIndex={0}
      className={cn(
        "relative overflow-hidden bg-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset",
        spanRows && "row-span-2",
      )}
      // Keyboard: Enter/Space opens directly (spec's accessibility section) —
      // bypasses the tap/double-tap disambiguation, same as every other media
      // surface fixed this way last session.
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onTap();
      }}
      onPointerDown={tap.onPointerDown}
      onPointerMove={tap.onPointerMove}
      onPointerUp={tap.onPointerUp}
      onPointerLeave={tap.onPointerLeave}
      onPointerCancel={tap.onPointerCancel}
    >
      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumb} alt="" loading="lazy" decoding="async" className="pointer-events-none h-full w-full object-cover" />
      ) : (
        <div className="pointer-events-none h-full w-full bg-gradient-to-br from-blue-600/25 to-violet-600/25" />
      )}
      {media.kind === "video" ? (
        <span className="pointer-events-none absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 backdrop-blur">
          <Play className="h-3 w-3 fill-white text-white" />
        </span>
      ) : null}
      {overlayCount !== null ? (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/55 text-xl font-bold text-white">
          +{overlayCount}
        </span>
      ) : null}
      <AnimatePresence>
        {burst > 0 ? (
          <motion.span
            key={burst}
            initial={{ opacity: 0, scale: 0.4 }}
            animate={{ opacity: [0, 1, 1, 0], scale: [0.4, 1.15, 1, 1.2] }}
            transition={{ duration: 0.8, times: [0, 0.2, 0.7, 1] }}
            className="pointer-events-none absolute inset-0 flex items-center justify-center drop-shadow-[0_2px_10px_rgba(0,0,0,0.5)]"
          >
            <WowSolid className="h-10 w-10" />
          </motion.span>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
