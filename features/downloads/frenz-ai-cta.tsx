import { ArrowRight, Compass, Wand2 } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE FRENZ AI TILE — the landing/download pair's first action
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-08: "Replace the features button with the frenz Ai button and
 * move the features button below the Frenz AI and wallpaper button below in
 * horizontal rectangular shape to full the section width."
 *
 * So the top row becomes [ Frenz AI | Wallpapers ] and Explore Features drops
 * beneath them as a full-width bar. Frenz AI takes the position Features held
 * because it is the newest thing the product does and the one the owner is
 * pushing; Features is a directory, and a directory can sit below the doors.
 *
 * ── Deliberately the same shape as the tile it replaces ─────────────────────
 *
 * Same height, same radius, same shadow, same icon-then-label-then-arrow
 * rhythm as the Wallpapers tile it now sits beside. A new tile that introduced
 * its own proportions would make the pair look assembled rather than designed.
 * What differs is the colour: this one carries the AI gradient, so the eye
 * lands on it first without it being physically larger.
 *
 * ── Cheap, because this is a 1.6-second route ───────────────────────────────
 *
 * A server component: no image, no blur, no JavaScript. The ambient field below
 * is two composited transforms — see the note on it for why that number and
 * those properties are the budget rather than a preference.
 */
export function FrenzAICta({ className }: { className?: string }) {
  return (
    <Link
      href="/ai"
      prefetch={false}
      className={cn(
        "group relative flex min-h-[11rem] flex-col overflow-hidden rounded-3xl p-4 text-left",
        "bg-gradient-to-br from-[#101744] via-[#1b1560] to-[#3b1063] text-white",
        "shadow-[0_10px_30px_-10px_rgba(49,46,129,0.55)] ring-1 ring-inset ring-white/10",
        "transition duration-200 hover:-translate-y-0.5 active:scale-[0.995]",
        className,
      )}
    >
      {/*
        ── 🔴 A LIVING AMBIENT FIELD, NOT A PHOTOGRAPH ─────────────────────

        Owner, 2026-09-08: "the wallpaper button should be gradient ai ambient
        background that feels alive and move just like gemini, dont use an image
        in the ai button."

        So the image is gone — including the uploadable slot that briefly
        existed for it — and this is two soft colour fields drifting past each
        other behind the copy.

        Why it is affordable on a page with a 1.6-second budget, which this
        feature has already blown once today:

          · TWO elements, not a scene. Each is one radial gradient;
          · they animate `transform` ONLY. No filter, no background-position,
            no opacity keyframes — all of which repaint. Transform is composited,
            so the main thread never sees a frame of this;
          · 19s and 23s, co-prime, so the pair never visibly repeats. An ambient
            field reads as alive precisely when you cannot find its beat;
          · both stop dead under `prefers-reduced-motion`.

        It is also why there is no `backdrop-blur` here: the softness is in the
        gradient's own falloff, which costs nothing, rather than in a filter
        that would re-blur the tile on every frame the blobs move.
      */}
      <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <span
          className="frenz-ai-ambient-a absolute -left-1/4 -top-1/4 h-[150%] w-[150%]"
          style={{
            background:
              "radial-gradient(closest-side, rgba(59,130,246,0.85) 0%, rgba(59,130,246,0.35) 45%, transparent 72%)",
          }}
        />
        <span
          className="frenz-ai-ambient-b absolute -bottom-1/4 -right-1/4 h-[150%] w-[150%]"
          style={{
            background:
              "radial-gradient(closest-side, rgba(217,70,239,0.75) 0%, rgba(139,92,246,0.32) 45%, transparent 72%)",
          }}
        />
      </span>

      {/*
        🔴 A WAND, NOT A SPARKLE (owner: "the ai button icon should be something
        more related to cleaning or ai").

        A four-pointed sparkle is the generic AI glyph every product uses, and
        it says "something clever happens" rather than what. A wand is the verb:
        it is what you point at a thing to remove what you do not want, and it
        is already the badge on the AI work scene — so the two surfaces now
        share one symbol for one action.
      */}
      <span className="relative z-[1] flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 via-indigo-500 to-fuchsia-500 text-white shadow-lg shadow-fuchsia-500/30">
        <Wand2 className="h-6 w-6" />
      </span>

      <span className="relative z-[1] mt-auto flex items-end justify-between gap-3 pt-4">
        <span className="min-w-0">
          <span className="block text-base font-bold leading-tight">Frenz AI</span>
          <span className="mt-1 block text-xs leading-snug text-white/70">
            Remove captions and text from your videos.
          </span>
        </span>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 ring-1 ring-inset ring-white/20 transition group-hover:bg-white/25">
          <ArrowRight className="h-4 w-4 text-white transition-transform group-hover:translate-x-0.5" />
        </span>
      </span>
    </Link>
  );
}

/**
 * Explore Features, as a full-width bar under the pair.
 *
 * It kept a whole tile when it was one of two things on this row. Below two
 * doors it is a signpost, and a signpost is a line — which is exactly the
 * "horizontal rectangular shape to full the section width" the owner drew.
 */
export function ExploreFeaturesBar({ className }: { className?: string }) {
  return (
    <Link
      href="/features"
      className={cn(
        "group flex w-full items-center gap-3 rounded-2xl bg-white px-4 py-3.5 text-slate-900",
        "shadow-[0_8px_24px_-8px_rgba(15,23,42,0.16)] ring-1 ring-inset ring-slate-900/[0.06]",
        "transition duration-200 hover:-translate-y-0.5 active:scale-[0.995]",
        "dark:bg-white/[0.04] dark:text-white dark:ring-white/10",
        className,
      )}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/25">
        <Compass className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold leading-tight">Explore Features</span>
        <span className="mt-0.5 block text-xs leading-snug text-slate-500 dark:text-white/60">
          See everything Frenz can do.
        </span>
      </span>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200/70 transition group-hover:bg-slate-200 dark:bg-white/10 dark:ring-white/15">
        <ArrowRight className="h-4 w-4 text-slate-600 transition-transform group-hover:translate-x-0.5 dark:text-white" />
      </span>
    </Link>
  );
}
