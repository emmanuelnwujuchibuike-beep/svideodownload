"use client";

import { LayoutGrid } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * The Quick actions button — the glass pill that sits OPPOSITE the
 * Fast · Secure · Private pill on the hero, on the landing page and on
 * /downloads (owner, 2026-09-20: "put a glass premium quick action button
 * next to the fast, secure and private card to sit opposite it … when clicked
 * it should open lazily and open the quick action card").
 *
 * ── What is in the first load, and what is not ───────────────────────────
 * This file is: one button and one piece of state. The sheet it opens is NOT
 * — `next/dynamic` fetches `quick-actions-sheet` on the first tap (and the
 * import is warmed on hover/focus/touch-start, so on a real device the chunk
 * is usually already there when the tap lands). The hero is the landing
 * page's LCP element and lives under a 1.6s budget; the bytes for a dialog
 * nobody has opened do not belong in it.
 *
 * ── Responsive by construction ───────────────────────────────────────────
 * Owner: "the quick action button must be responsive on all devices … so it
 * doesn't press together with the fast, secure and private card." Under
 * 440px the label is dropped and the pill becomes a 38px glyph (the
 * accessible name stays): the trust pill is ~244px wide, so with the label
 * the two only fit side by side from 440px up, and a 360–412px phone fits
 * both, with air between them, only as a glyph. The row also wraps, so on a
 * 320px screen the button drops to its own line rather than pressing into
 * the pill. Measured, not guessed — scripts/_qa-shots-local.tmp.mjs prints
 * the gap on iPhone SE, Pixel 7 and a desktop.
 *
 * ── Glass without a blur pass ────────────────────────────────────────────
 * The hero sits on a flat canvas (see the note on the trust pill), so a
 * `backdrop-blur` here would cost a GPU layer to blur nothing. The glass read
 * comes from a translucent fill, a gradient hairline, an inner top highlight
 * and a tinted shadow — all static paint.
 */
const QuickActionsSheet = dynamic(() => import("./quick-actions-sheet").then((m) => m.QuickActionsSheet), { ssr: false });

/** Warm the chunk before the tap; harmless if it never comes. */
const warm = () => {
  void import("./quick-actions-sheet");
};

export function QuickActionsButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  /** Once true the sheet stays mounted (closed) so re-opening is instant and the close animation can play. */
  const [everOpened, setEverOpened] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        type="button"
        aria-label="Quick actions"
        aria-haspopup="dialog"
        aria-expanded={open}
        onPointerEnter={warm}
        onPointerDown={warm}
        onFocus={warm}
        onTouchStart={warm}
        onClick={() => {
          setEverOpened(true);
          setOpen(true);
        }}
        className={cn(
          "group relative inline-flex h-9 shrink-0 items-center gap-2 rounded-2xl p-px text-xs font-semibold",
          // the gradient hairline — a padded gradient behind a translucent core
          "bg-gradient-to-r from-blue-500/50 via-violet-500/45 to-fuchsia-500/50 shadow-[0_6px_18px_-8px_rgba(99,102,241,0.55)]",
          "transition-[transform,box-shadow] duration-200 [transition-timing-function:var(--ease-out)] hover:shadow-[0_10px_24px_-8px_rgba(99,102,241,0.6)] active:scale-[0.96]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          className,
        )}
      >
        <span
          className={cn(
            "inline-flex h-full items-center gap-2 rounded-[calc(1rem-1px)] px-1.5 text-slate-800",
            "bg-white/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] min-[440px]:pr-3",
            "dark:bg-[#0b1020]/85 dark:text-white dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]",
          )}
        >
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-[10px] bg-gradient-to-br from-blue-500 to-violet-600 text-white shadow-sm transition-transform duration-300 [transition-timing-function:var(--ease-out)] group-hover:rotate-6">
            <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
          </span>
          {/* Icon-only under 440px — see the responsive note above. */}
          <span className="hidden whitespace-nowrap min-[440px]:inline">Quick actions</span>
        </span>
      </button>
      {everOpened ? <QuickActionsSheet open={open} onClose={close} /> : null}
    </>
  );
}
