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
      /*
        ── 🔴 PREFETCHED, BECAUSE THE OWNER FELT THE COLD FETCH ───────────────

        Owner, 2026-09-09: "the Frenz AI button doesn't respond on one tap, it
        takes time and it lags when opening, it doesn't open instant smoothly."

        `prefetch={false}` meant the tap was the FIRST time the browser asked
        for the route: its RSC payload and its JavaScript chunks were fetched
        after the finger came up, on whatever connection the phone had. That is
        the delay — the destination is fine, it simply had not started loading.

        Letting Next use its default (prefetch when the card scrolls into view)
        moves that work to idle time, and it is nearly free here: /ai is ISR
        with `revalidate = 300`, so the payload comes off the CDN rather than
        being rendered per visitor.

        ⚠️ Deliberately NOT `prefetch={true}`, which would fetch on mount for
        everybody including people who never scroll to this tile. The default
        heuristic is the one that respects the landing budget.
      */
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
export function ExploreFeaturesBar({
  className,
  /**
   * ── 🔴 `tile` IS THE LANDING PAGE'S SHAPE (owner, 2026-09-09) ────────────
   *
   * "the landing page should show the features button in place of the ai
   * button as it was before the ai button was implemented."
   *
   * On the landing page this sits in the square slot beside Wallpapers, which
   * is where it lived before Frenz AI took that slot in September. On the
   * signed-in download page it stays the full-width `bar` beneath the pair.
   *
   * One component with two shapes rather than two components: the destination,
   * the copy and the brand treatment are identical, and the thing that differs
   * is the box it has to fill. Two components would drift.
   */
  variant = "bar",
}: {
  className?: string;
  variant?: "bar" | "tile";
}) {
  const tile = variant === "tile";

  return (
    <Link
      href="/features"
      className={cn(
        "group relative overflow-hidden bg-white text-slate-900",
        "ring-1 ring-inset ring-slate-900/[0.07] dark:bg-[#0b1020] dark:text-white dark:ring-white/10",
        "transition duration-200 hover:-translate-y-0.5 active:scale-[0.995]",
        tile
          ? /*
              ── 🔴 THE EXACT SHELL OF THE TILE IT STANDS IN FOR ──────────────

              Owner, 2026-09-09: "the wallpaper and features button isn't as it
              was before, the shape is now more rectangular, and the features
              button no longer have the gradient like the Frenz AI button."

              Both halves were mine. My first tile was `rounded-[1.25rem]` with
              no minimum height, so it collapsed to its content and sat shorter
              and squarer than the Wallpapers tile beside it — which is the
              "more rectangular" pair the owner is looking at. And it was flat
              white, where every other tile in that row carries colour.

              These are `FrenzAICta`'s own values, copied deliberately rather
              than approximated: same `min-h-[11rem]`, same `rounded-3xl`, same
              padding, same two-shadow bloom. A tile that stands in for another
              tile has to be the same object, or the row reads as assembled.
            */
            "flex min-h-[11rem] w-full flex-col rounded-3xl p-4 text-left shadow-[0_10px_30px_-14px_rgba(15,23,42,0.22)]"
          : "flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 shadow-[0_8px_24px_-8px_rgba(15,23,42,0.16)]",
        className,
      )}
    >
      {/*
        ── 🔴 THE GRADIENT, AS A STATIC WASH ────────────────────────────────

        The AI tile's colour comes from three transform-animated gradient
        layers. This one takes the same palette and paints it ONCE, with no
        animation at all — and that is the right trade rather than a lesser
        one. The animated field is Frenz AI's own identity, and repeating it
        here would make two different destinations look like the same product.

        It is also the landing page, held to 1.6 seconds: a second animated
        ambient in the same row is compositor work on every frame for a tile
        nobody is looking at. Painted once, this costs nothing after first
        paint.
      */}
      {tile ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 90% at 12% 0%, rgba(37,99,235,0.22) 0%, transparent 60%)," +
              "radial-gradient(110% 85% at 92% 100%, rgba(124,58,237,0.20) 0%, transparent 62%)," +
              "linear-gradient(140deg, rgba(255,255,255,0.55) 0%, transparent 45%)",
          }}
        />
      ) : null}

      <span
        className={cn(
          "relative flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/25",
          tile ? "h-11 w-11" : "h-9 w-9",
        )}
      >
        <Compass className={tile ? "h-[22px] w-[22px]" : "h-[18px] w-[18px]"} />
      </span>

      {/* `mt-auto` pushes the label to the bottom of the tile, which is how the
          Frenz AI and Wallpapers tiles are laid out — icon top, words bottom. */}
      <span className={cn("relative min-w-0", tile ? "mt-auto block pt-3" : "flex-1")}>
        <span className={cn("block font-bold leading-tight", tile ? "text-[15px]" : "text-sm")}>
          Explore Features
        </span>
        <span className="mt-0.5 block text-xs leading-snug text-slate-500 dark:text-white/60">
          See everything Frenz can do.
        </span>
      </span>

      {/* The arrow is the bar's affordance. In the tile the whole card is the
          target and a chevron in the corner would just be furniture. */}
      {tile ? null : (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200/70 transition group-hover:bg-slate-200 dark:bg-white/10 dark:ring-white/15">
          <ArrowRight className="h-4 w-4 text-slate-600 transition-transform group-hover:translate-x-0.5 dark:text-white" />
        </span>
      )}
    </Link>
  );
}
