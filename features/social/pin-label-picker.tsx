"use client";

import { motion } from "framer-motion";

import { MAX_PINNED, PIN_LABELS } from "@/lib/social/comment-meta";
import { cn } from "@/lib/utils";

/** Pin-category flyout — post-owner-only, opened rarely (only when moderating
 *  a thread), so it's code-split out of every viewer's initial comment bundle
 *  the same way ReportSheet already is. */
export function PinLabelPicker({ onPick }: { onPick: (label: string) => void }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.95, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.12 }} className="absolute right-0 z-50 mt-1 w-56 overflow-hidden rounded-2xl border border-border/60 bg-card/95 p-1.5 shadow-elevated backdrop-blur-xl">
      <p className="px-2 pb-1 pt-0.5 text-[11px] font-semibold text-muted-foreground">Pin as… (up to {MAX_PINNED})</p>
      <div className="flex flex-wrap gap-1">
        {PIN_LABELS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onPick(p.id)}
            className={cn("rounded-full border px-2 py-1 text-xs font-semibold transition hover:opacity-80", p.tint)}
          >
            {p.emoji} {p.label}
          </button>
        ))}
      </div>
    </motion.div>
  );
}
