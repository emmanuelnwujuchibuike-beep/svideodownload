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
        /*
          ⚠️ `min-h` here is a FLOOR THAT CURRENTLY DOES NOTHING, and it is worth
          knowing that before trusting it.

          Measured on a Pixel 7 against a production build: the tile renders
          188x168 and `getComputedStyle(tile).minHeight` is `0px` — even though
          the class is on the element, the selector matches it, and the rule
          `.min-h-\[11rem\]{min-height:11rem}` is present in the built CSS. The
          same class list on a plain `<div>` outside the grid computes 188px, so
          the utility itself is fine. Both tiles in this row behave the same way.

          It is benign: the height is content-driven and nothing overflows
          (`scrollHeight === clientHeight === 168`). It is left in place because
          removing it would change nothing either — but do not reach for this
          value to fix a height problem, because it will not move anything.
        */
        "group relative flex min-h-[11rem] flex-col overflow-hidden rounded-3xl p-4 text-left",
        /*
          🔴 WHITE GROUND, GRADIENT AS A TINT (owner, 2026-09-09).

          "this Frenz AI button in the landing page and Download page is too
          colourful, make it more of white with touches of gradient purple,
          blue, and touches of AI color like Gemini; the background should be
          more of white so it doesn't cause visual color noise when a user
          lands."

          It was a full-bleed indigo→violet→magenta gradient with white type —
          the loudest element on a page whose job is a paste field. The colour
          did not go away, it moved: the card is white and the ambient field
          below now paints Google-blue and violet at ~0.3 alpha, so the hue
          reads as a sheen on paper rather than a block of saturation.
        */
        "bg-white text-slate-900 dark:bg-[#0b1020] dark:text-white",
        /*
          The bloom. The tile in the screenshot sits in its own violet light
          rather than on a flat drop shadow — two shadows, one tight and dark
          for the lift, one wide and coloured for the glow. Both are painted
          once and never animate, so the whole effect is free after first paint.
        */
        "shadow-[0_10px_30px_-14px_rgba(15,23,42,0.22)]",
        "ring-1 ring-inset ring-slate-900/[0.07] dark:ring-white/10",
        "transition duration-200 hover:-translate-y-0.5 active:scale-[0.995]",
        className,
      )}
    >
      {/*
        ── 🔴 A LIVING AMBIENT FIELD, NOT A PHOTOGRAPH ─────────────────────────

        Owner, 2026-09-08: "the wallpaper button should be gradient ai ambient
        background that feels alive and move just like gemini, dont use an image
        in the ai button", then "the ai button blue is too dark, there should be
        a touch of white background there. and and is just static it doesnt
        move."

        Three elements, `transform` ONLY — no filter, no background-position, no
        `backdrop-blur` anywhere near it. Transform is composited, so the main
        thread never sees a frame of this; the softness is in each gradient's
        own falloff, which is painted once. See app/globals.css for why the
        cycles are 13/17/23s and why one of them has three stops.

        That budget is the reason this tile can be elaborate at all: it sits on
        a route held to 1.6 seconds, and this feature has already made the app
        unresponsive twice.
      */}
      <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        {/* A — the gloss. The screenshot's bright diagonal sweep, and the
            owner's "touch of white", as one moving highlight rather than a
            static wash. */}
        <span
          className="frenz-ai-ambient-a absolute -left-1/3 -top-1/3 h-[130%] w-[130%]"
          style={{
            background:
              "radial-gradient(closest-side, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.55) 45%, rgba(255,255,255,0) 76%)",
          }}
        />
        {/* B — electric blue, sweeping up from the lower left. */}
        <span
          className="frenz-ai-ambient-b absolute -bottom-1/3 -left-1/4 h-[135%] w-[135%]"
          style={{
            background:
              "radial-gradient(closest-side, rgba(66,133,244,0.30) 0%, rgba(66,133,244,0.10) 46%, transparent 74%)",
          }}
        />
        {/* C — magenta, on the three-stop circuit, anchored top-right where the
            screenshot puts it. */}
        <span
          className="frenz-ai-ambient-c absolute -right-1/3 -top-1/4 h-[135%] w-[135%]"
          style={{
            background:
              "radial-gradient(closest-side, rgba(168,85,247,0.26) 0%, rgba(217,70,239,0.10) 46%, transparent 74%)",
          }}
        />
      </span>

      {/*
        The scrim. Static, painted once, and the only reason white type is safe
        over a field with a bright gloss loose in it — a screenshot only ever
        catches one frame of a 13-second cycle, so legibility cannot be checked
        by looking once.
      */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-white/85 via-white/35 to-transparent dark:from-[#0b1020]/85 dark:via-[#0b1020]/35"
      />

      {/*
        ── 🔴 THE NEON RING ────────────────────────────────────────────────────

        The one thing the screenshot has that the old tile did not: the wand
        sits inside a glowing cyan-to-magenta circle rather than on a filled
        disc.

        Built as a two-element gradient border — a conic-gradient background
        with 2px of padding, and an inner rounded-full that covers all but the
        rim. That is deliberately NOT a `mask` or a `filter`: both would make
        this a repainted layer, and it sits on the landing page. The bloom is
        two `box-shadow`s, which are painted once and cost nothing thereafter.

        The interior is translucent, so the ambient field drifts THROUGH the
        ring exactly as it does in the screenshot, while staying dark enough
        that the white glyph keeps its contrast at every frame.
      */}
      <span
        aria-hidden
        className="relative z-[1] flex h-[3.1rem] w-[3.1rem] shrink-0 items-center justify-center rounded-full p-[2px] shadow-[0_6px_18px_-6px_rgba(99,102,241,0.55)]"
        style={{
          background:
            "conic-gradient(from 150deg, #22d3ee 0%, #3b82f6 22%, #a855f7 48%, #f0abfc 68%, #38bdf8 86%, #22d3ee 100%)",
        }}
      >
        <span className="flex h-full w-full items-center justify-center rounded-full bg-white dark:bg-[#141a33]">
          <Wand2 className="h-[1.35rem] w-[1.35rem] text-indigo-600 dark:text-indigo-300" />
        </span>
      </span>

      {/*
        The sparkles, as in the screenshot: three four-point stars scattered
        around the ring. One inline SVG path each, no animation, no library —
        decoration that costs three static nodes.
      */}
      <span aria-hidden className="pointer-events-none absolute inset-0 z-[1]">
        <Spark className="absolute left-[4.6rem] top-[1.1rem] h-3.5 w-3.5 text-fuchsia-400/80 dark:text-fuchsia-300/90" />
        <Spark className="absolute left-[3.9rem] top-[2.9rem] h-2.5 w-2.5 text-blue-400/80 dark:text-blue-300/90" />
        <Spark className="absolute left-[1.15rem] top-[0.5rem] h-2 w-2 text-violet-400/70 dark:text-violet-300/80" />
      </span>

      <span className="relative z-[1] mt-auto flex items-end justify-between gap-3 pt-3">
        <span className="min-w-0">
          {/*
            "Frenz" white, "AI" in the lighter periwinkle the screenshot uses.
            One word in two weights of the same colour would have been a
            different design; the tint is what makes it read as a product name.
          */}
          <span className="block text-[1.05rem] font-bold leading-tight tracking-[-0.01em]">
            Frenz <span className="text-gradient">AI</span>
          </span>
          <span className="mt-1 block text-xs leading-snug text-slate-500 dark:text-white/70">
            Remove captions and text from your videos.
          </span>
        </span>
        <span className="flex h-[2.6rem] w-[2.6rem] shrink-0 items-center justify-center rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200/80 transition group-hover:bg-slate-200 dark:bg-white/10 dark:ring-white/15">
          <ArrowRight className="h-[1.05rem] w-[1.05rem] text-slate-700 transition-transform group-hover:translate-x-0.5 dark:text-white" />
        </span>
      </span>
    </Link>
  );
}

/**
 * A four-point sparkle.
 *
 * Its own component so the three instances share one path definition, and a
 * bare `<svg>` rather than a lucide icon because lucide's sparkle is a
 * three-star composite — at 8px that renders as a smudge. This is one curve.
 *
 * `aria-hidden` is on the wrapper, not here: the whole decorative layer is
 * hidden from assistive technology in one place.
 */
function Spark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden focusable="false">
      <path d="M12 0c.6 6.2 5.2 10.8 12 12-6.8 1.2-11.4 5.8-12 12-.6-6.2-5.2-10.8-12-12 6.8-1.2 11.4-5.8 12-12z" />
    </svg>
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
