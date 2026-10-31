"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef } from "react";

import { REACTIONS, type ReactionEmotion } from "@/features/social/reaction-glyphs";
import { cn } from "@/lib/utils";

/**
 * Wow reaction picker — long-press the Wow button and a strip of flavors pops
 * up (owner spec). Selecting one still counts as a Wow (one row, one count);
 * the flavor rides along as `emotion`.
 *
 * The flavors and glyph helpers live in reaction-glyphs.tsx (2026-10-31: the feed card loads this picker only when
 * it is needed); re-exported here so every existing import keeps working.
 */
export { makeEmotionIcon, REACTIONS, reactionGlyph, type ReactionEmotion } from "@/features/social/reaction-glyphs";

export function ReactionPicker({
  open,
  onClose,
  onPick,
  /** "up" pops above the anchor (feed action bar); "left" pops beside it (reel rail). */
  align = "up",
}: {
  open: boolean;
  onClose: () => void;
  onPick: (emotion: ReactionEmotion, glyph: string, e: React.MouseEvent) => void;
  align?: "up" | "left";
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  // Dismiss on outside tap / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Delay so the long-press's own release doesn't instantly dismiss it.
    const t = setTimeout(() => {
      document.addEventListener("pointerdown", onDown);
      window.addEventListener("keydown", onKey);
    }, 50);
    return () => {
      clearTimeout(t);
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          ref={ref}
          role="menu"
          aria-label="Pick a reaction"
          initial={{ opacity: 0, scale: 0.85, y: align === "up" ? 6 : 0, x: align === "left" ? 6 : 0 }}
          animate={{ opacity: 1, scale: 1, y: 0, x: 0 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          className={cn(
            "absolute z-40 flex items-center gap-0.5 rounded-full border border-border/60 bg-card/95 px-2 py-1.5 shadow-xl backdrop-blur-xl",
            align === "up" ? "bottom-full left-0 mb-2 origin-bottom-left" : "right-full top-1/2 mr-2 -translate-y-1/2 origin-right flex-wrap justify-center",
            align === "left" && "w-44",
          )}
        >
          {REACTIONS.map((r, i) => (
            <motion.button
              key={r.id}
              type="button"
              role="menuitem"
              aria-label={r.label}
              title={r.label}
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.02, type: "spring", stiffness: 520, damping: 26 }}
              onClick={(e) => {
                onPick(r.id, r.glyph, e);
                onClose();
              }}
              className="flex h-9 w-9 items-center justify-center rounded-full text-[20px] leading-none transition hover:scale-125 hover:bg-secondary active:scale-95"
            >
              {r.glyph}
            </motion.button>
          ))}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
