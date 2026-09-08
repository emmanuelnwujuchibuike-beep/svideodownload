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
 * is three composited transforms — see the note on it for why that number and
 * those properties are the budget rather than a preference.
 */
export function FrenzAICta({ className }: { className?: string }) {
  return (
    <Link
      href="/ai"
      prefetch={false}
      className={cn(
        "group relative flex min-h-[11rem] flex-col overflow-hidden rounded-3xl p-4 text-left",
        "bg-gradient-to-br from-[#4f7ef8] via-[#7159f4] to-[#a855f7] text-white",
        "shadow-[0_10px_30px_-10px_rgba(79,70,229,0.55)] ring-1 ring-inset ring-white/20",
        "transition duration-200 hover:-translate-y-0.5 active:scale-[0.995]",
        className,
      )}
    >
      {/*
        ── 🔴 A LIVING AMBIENT FIELD, NOT A PHOTOGRAPH ───────────────────

        Owner, 2026-09-08: "the wallpaper button should be gradient ai ambient
        background that feels alive and move just like gemini, dont use an image
        in the ai button."

        And, after seeing it: "the ai button blue is too dark, there should be a
        touch of white background there. and and is just static it doesnt move."

        Both were fair. The base was #101744 — near-black navy — so every blob
        painted on top of it landed as a dark bruise rather than as light, and
        the two of them were so large and so soft that their real, measured
        travel was invisible. See app/globals.css for the motion rewrite; what
        changed HERE is the palette.

        ── THE WHITE IS A LAYER, NOT A TINT ────────────────────────────

        Blob A is white and it MOVES, which is the difference between a tile
        that has a touch of white in it and a tile that is simply lighter. A
        static wash would have satisfied the words and missed the ask: light
        drifting across a surface is the thing that reads as alive.

        ── WHY THE SCRIM EXISTS ──────────────────────────────────

        White text over a field with a white blob wandering through it is
        unreadable for whatever seconds the blob spends behind the words — and
        it would pass every review, because a screenshot only catches one frame
        of a 13-second cycle. The scrim is a STATIC bottom gradient: painted
        once, never animated, and it guarantees the copy reads at every frame
        rather than at most of them. It is the same device the Wallpapers tile
        beside it uses for its label.
      */}
      <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        {/* A — the white. Fastest, so the light is what you notice moving. */}
        <span
          className="frenz-ai-ambient-a absolute -left-1/3 -top-1/3 h-[130%] w-[130%]"
          style={{
            background:
              "radial-gradient(closest-side, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.42) 38%, rgba(255,255,255,0) 72%)",
          }}
        />
        {/* B — sky, sweeping up from the lower left. */}
        <span
          className="frenz-ai-ambient-b absolute -bottom-1/3 -left-1/4 h-[135%] w-[135%]"
          style={{
            background:
              "radial-gradient(closest-side, rgba(56,189,248,0.95) 0%, rgba(37,99,235,0.35) 45%, transparent 74%)",
          }}
        />
        {/* C — fuchsia, on the three-stop circuit. */}
        <span
          className="frenz-ai-ambient-c absolute -right-1/3 -top-1/4 h-[135%] w-[135%]"
          style={{
            background:
              "radial-gradient(closest-side, rgba(240,120,255,0.85) 0%, rgba(168,85,247,0.3) 45%, transparent 74%)",
          }}
        />
      </span>

      {/* The scrim. Static, painted once, and the only reason white type is
          safe over a field with a white blob loose in it. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-[#1e1650]/75 via-[#1e1650]/22 to-transparent"
      />

      {/*
        🔴 A WAND, NOT A SPARKLE (owner: "the ai button icon should be something
        more related to cleaning or ai").

        A four-pointed sparkle is the generic AI glyph every product uses, and
        it says "something clever happens" rather than what. A wand is the verb:
        it is what you point at a thing to remove what you do not want, and it
        is already the badge on the AI work scene — so the two surfaces now
        share one symbol for one action.
      */}
      <span className="relative z-[1] flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 via-indigo-600 to-fuchsia-600 text-white shadow-lg shadow-indigo-900/30 ring-1 ring-inset ring-white/30">
        <Wand2 className="h-6 w-6" />
      </span>

      <span className="relative z-[1] mt-auto flex items-end justify-between gap-3 pt-4">
        <span className="min-w-0">
          <span className="block text-base font-bold leading-tight">Frenz AI</span>
          <span className="mt-1 block text-xs leading-snug text-white/85">
            Remove captions and text from your videos.
          </span>
        </span>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20 ring-1 ring-inset ring-white/30 transition group-hover:bg-white/30">
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
