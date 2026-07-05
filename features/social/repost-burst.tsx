"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Repeat2 } from "lucide-react";

/**
 * A subtle OS-style confirmation bubble that pops above the Repost button the
 * moment a repost succeeds (à la an iMessage tapback). Purely decorative: absolutely
 * positioned, `pointer-events-none`, and self-clearing via AnimatePresence keyed on
 * the trigger. Emerald is the established repost accent (see the active Repost icon);
 * a single quick spring keeps it premium, never noisy. Pass a changing `triggerKey`
 * (e.g. `Date.now()`) to play it; `null` shows nothing.
 */
export function RepostBurst({ triggerKey }: { triggerKey: number | null }) {
  return (
    <AnimatePresence>
      {triggerKey ? (
        <motion.span
          key={triggerKey}
          aria-hidden
          initial={{ opacity: 0, scale: 0.5, y: 4 }}
          animate={{ opacity: [0, 1, 1, 0], scale: [0.5, 1.12, 1, 1.06], y: [4, -4, -8, -22] }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1], times: [0, 0.25, 0.6, 1] }}
          className="pointer-events-none absolute -top-1 left-1/2 z-40 -translate-x-1/2 -translate-y-full"
        >
          <span className="flex items-center gap-1 whitespace-nowrap rounded-full bg-emerald-500 px-2 py-1 text-[11px] font-bold text-white shadow-lg shadow-emerald-500/40">
            <Repeat2 className="h-3.5 w-3.5" /> Reposted
          </span>
        </motion.span>
      ) : null}
    </AnimatePresence>
  );
}
