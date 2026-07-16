"use client";

import { EyeOff, Loader2, Plus } from "lucide-react";

import { useHomeModules } from "@/features/app-shell/dashboard/home-modules-store";
import { HOME_MODULE_LABELS } from "@/lib/social/home-preferences";
import { haptic } from "@/lib/motion/haptics";
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

  return (
    <section aria-label="Hidden sections" className="rounded-2xl border border-dashed border-border/70 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <EyeOff className="h-3.5 w-3.5" />
          {hidden.length === 1 ? "A section is hidden" : `${hidden.length} sections are hidden`}
        </span>
        {hidden.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => restore(key)}
            className="inline-flex items-center gap-1 rounded-full bg-primary/10 py-1 pl-2 pr-2.5 text-xs font-semibold text-primary transition hover:bg-primary/15"
          >
            {pending === key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            {HOME_MODULE_LABELS[key]}
          </button>
        ))}
      </div>
    </section>
  );
}
