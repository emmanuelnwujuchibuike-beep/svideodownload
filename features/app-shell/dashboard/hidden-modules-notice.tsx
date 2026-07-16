"use client";

import { motion, useReducedMotion } from "framer-motion";
import { EyeOff, Loader2, Plus } from "lucide-react";

import { useHomeModules } from "@/features/app-shell/dashboard/home-modules-store";
import { HOME_MODULE_LABELS } from "@/lib/social/home-preferences";
import { haptic } from "@/lib/motion/haptics";
import { springs } from "@/lib/motion/springs";
import { playSound } from "@/lib/notifications/sound-fx";

/**
 * "Option 2" (owner's pick, 2026-07-16) for the Continue Watching mystery.
 *
 * The report was "Continue Watching only shows in the admin account". It turned
 * out not to be a bug: three accounts had `hidden_modules:
 * ["continue_watching"]` saved and the owner's own had `[]`. Three of four rows
 * hiding EXACTLY one module doesn't look like curation, it looks like an
 * easy-to-hit control with no visible way back. So Home says when something is
 * hidden, right where it went missing, and restores it in one tap.
 *
 * Corrected 2026-07-16 (same day, owner): restoring "just loads and
 * disappears". It did — the chip spun, removed itself, and the section stayed
 * gone until Home was re-fetched, because visibility was a server-side filter.
 * The section list is client-gated now (home-modules-store.tsx), so this reads
 * live state instead of a server snapshot: the chip disappears and the section
 * appears in the same frame, and hiding something above re-adds its chip here
 * immediately.
 */
export function HiddenModulesNotice() {
  const { hidden, show, pending } = useHomeModules();
  const reduceMotion = useReducedMotion();
  if (hidden.length === 0) return null;

  const restore = (key: (typeof hidden)[number]) => {
    haptic("selection");
    playSound("tap");
    // `show` is optimistic + surgical: it flips local state now and PATCHes
    // `showModule` (never a client-computed full array), so it can't clobber a
    // change made in another tab or in the Home Modules Editor at the same
    // moment.
    show(key);
  };

  // Owner (2026-07-16): "remove that a section is hidden text … only leave the
  // eyes closed and remove the dotted round that points the area, the eyes
  // close and plus continue watching button is enough." So: no dashed frame, no
  // explanatory sentence — just the closed eye and the restore chip(s).
  return (
    <section aria-label="Hidden sections" className="flex flex-wrap items-center gap-2">
      <EyeOff aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
      {hidden.map((key) => (
        <motion.button
          key={key}
          type="button"
          onClick={() => restore(key)}
          whileTap={reduceMotion ? undefined : { scale: 0.94 }}
          transition={springs.press}
          // The chip is the only affordance left, so it carries the whole
          // action in its own label rather than leaning on nearby prose.
          aria-label={`Show ${HOME_MODULE_LABELS[key]}`}
          className="inline-flex items-center gap-1.5 rounded-full bg-secondary py-1.5 pl-2.5 pr-3 text-xs font-semibold text-foreground shadow-sm ring-1 ring-border/60 transition-colors hover:bg-secondary/70"
        >
          {pending === key ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
          )}
          {HOME_MODULE_LABELS[key]}
        </motion.button>
      ))}
    </section>
  );
}
