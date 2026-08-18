"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

import { WowSolid } from "@/components/brand/wow-icon";
import { haptic } from "@/lib/motion/haptics";
import { playSound } from "@/lib/notifications/sound-fx";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE ONE DOUBLE-TAP-TO-WOW BURST (2026-08-18)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner: "reels, feed, multi post, single post, video post should use one
 * wow animation and haptic sound." Before this there were FOUR near-copies —
 * feed-video.tsx, feed-image.tsx, media-grid.tsx's GridCell, and
 * media-carousel.tsx each had their own hand-tuned version, which is exactly
 * how they drifted: one got resized twice this same day and the other three
 * never did, so "multi post double tap wow animation is still small" while
 * the video one had become too big in the other direction. One component
 * fixes that at the source.
 *
 * Went through two size passes before landing here: too small, then too big
 * ("occupy a large part of the screen"), then reduced again ("reduce it a
 * bit"). Deliberately more modest than either extreme.
 *
 * ── PORTALED, not absolutely positioned inside its caller ──────────────────
 *
 * Owner: "it seems to be fixed in the video container... it should animate
 * out of the container." Every caller's media box is `overflow-hidden` for
 * its own rounded corners (feed-video.tsx's own sizing there has already
 * been rewritten three times this session — `w-fit`/`aspect-ratio`/`lg:flex`
 * all lean on each other, and restructuring it again to carve out an
 * overflow-visible layer risked re-breaking that). Rendering into a
 * `document.body` portal at `position: fixed`, positioned from the caller's
 * own measured `anchorRef` rect, sidesteps every ancestor's `overflow`
 * entirely — the burst can rise past the media's edge over whatever's
 * beneath it, without touching that fragile CSS at all.
 *
 * `fireWowFeedback()` is the haptic+sound half, exported separately so a
 * call site's own gesture-detection code (which stays local — a double-tap
 * on a video, a photo, and a grid cell are genuinely different pointer
 * logic) can fire it at the exact moment it decides "this was a double tap".
 */

export function fireWowFeedback(): void {
  haptic("wow");
  playSound("wow");
}

export function WowBurst({ burstKey, anchorRef }: { burstKey: number; anchorRef: RefObject<HTMLElement | null> }) {
  const [rect, setRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);

  // Re-measure every time a burst actually fires — the anchor may have
  // scrolled since the last one, and this only needs to be right at the
  // instant a new burst mounts, not tracked continuously.
  useEffect(() => {
    if (burstKey <= 0) return;
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [burstKey, anchorRef]);

  if (typeof document === "undefined" || !rect) return null;

  return createPortal(
    <AnimatePresence>
      {burstKey > 0 ? (
        <span
          className="pointer-events-none fixed z-[70] flex items-center justify-center"
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
        >
          <motion.span
            key={burstKey}
            initial={{ opacity: 0, scale: 0.3, y: "0%", rotate: -8 }}
            animate={{
              opacity: [0, 1, 1, 0],
              scale: [0.3, 1.5, 1.3, 1.1],
              y: ["0%", "-15%", "-70%", "-130%"],
              rotate: [-8, 5, -2, 0],
            }}
            transition={{ duration: 1.05, ease: [0.16, 1, 0.3, 1], times: [0, 0.2, 0.65, 1] }}
            className="drop-shadow-[0_16px_28px_rgba(0,0,0,0.5)]"
          >
            <WowSolid className="h-20 w-20 sm:h-24 sm:w-24" />
          </motion.span>
        </span>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
