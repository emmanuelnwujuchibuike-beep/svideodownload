"use client";

import { Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { CarouselMedia } from "@/features/media/media-carousel";
import { fireWowFeedback, WowBurst } from "@/features/ui/wow-burst";
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
  onDoubleTapLike,
  className,
}: {
  items: CarouselMedia[];
  onExpandItem: (index: number, item: CarouselMedia) => void;
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
  const cellRef = useRef<HTMLDivElement | null>(null);
  const tap = useTapOrDoubleTap({
    onTap,
    onDoubleTap: () => {
      // 🔴 WAS SILENT — no haptic/sound at all (owner, 2026-08-18: "i didnt
      // hear any haptic sound in multi post in feed"). Every other media
      // surface already had this; the grid was the one place it was never
      // added in the first place, not a regression.
      fireWowFeedback();
      setBurst((b) => b + 1);
      onDoubleTap();
    },
  });
  const thumb = media.thumbnailUrl ?? (media.kind === "image" ? media.url : null);

  return (
    <div
      ref={cellRef}
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
      {/*
        🔴 A "+" SIGN AND "SEE MORE", TOGETHER (owner, 2026-08-17: "it should
        show a + sign and a see more next to it on the fourth image"). A bare
        "+N" number alone was under-specifying it — both elements are the
        ask, not just the count.
      */}
      {overlayCount !== null ? (
        <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-black/60 text-white">
          <span className="text-2xl font-bold leading-none">+{overlayCount}</span>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-white/85">See more</span>
        </span>
      ) : null}
      {/* Shared with every other media surface now (owner, 2026-08-18: "multi
          post double tap wow animation is still small, all multi, video and
          single post should have same one animation"). Portaled, so it
          isn't clipped by this cell's own `overflow-hidden`. */}
      <WowBurst burstKey={burst} anchorRef={cellRef} />
    </div>
  );
}
