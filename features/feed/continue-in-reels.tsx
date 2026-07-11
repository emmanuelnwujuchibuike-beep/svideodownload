"use client";

import { motion, type PanInfo } from "framer-motion";
import { ChevronUp, Play } from "lucide-react";

const SWIPE_UP_THRESHOLD = 56;

/**
 * Replaces the old dead-end "You're all caught up" message at the bottom of
 * the feed — the feed running out of new posts shouldn't feel like a stop
 * sign. Tapping OR swiping up opens the full Reels experience, reusing
 * whatever's already loaded/preloaded (see smart-feed.tsx's `continueInReels`
 * — same mechanism the For You/Following/Reels segmented control already
 * uses), so it opens with zero spinner.
 */
export function ContinueInReels({ onOpen }: { onOpen: () => void }) {
  const handlePanEnd = (_event: unknown, info: PanInfo) => {
    if (info.offset.y < -SWIPE_UP_THRESHOLD) onOpen();
  };

  return (
    <motion.button
      type="button"
      onClick={onOpen}
      onPanEnd={handlePanEnd}
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      whileTap={{ scale: 0.98 }}
      className="group relative mx-auto mt-2 flex w-full max-w-md flex-col items-center gap-2 overflow-hidden rounded-3xl bg-gradient-to-br from-blue-600 via-violet-600 to-purple-600 px-6 py-7 text-center shadow-luxury brand-glow"
    >
      {/* Ambient shine sweep — same premium-CTA language used elsewhere (e.g. the downloader's submit button). */}
      <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/15 to-transparent transition-transform duration-700 group-hover:translate-x-full" />

      <motion.span
        aria-hidden
        animate={{ y: [0, -5, 0] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 text-white ring-1 ring-inset ring-white/25 backdrop-blur"
      >
        <Play className="h-5 w-5 fill-white" />
      </motion.span>

      <span className="text-base font-bold text-white">Continue in Reels</span>
      <span className="flex items-center gap-1 text-xs font-medium text-white/75">
        <ChevronUp className="h-3.5 w-3.5" /> Swipe up or tap to keep watching
      </span>
    </motion.button>
  );
}
