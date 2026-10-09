import { ArrowRight, Compass, Wand2 } from "lucide-react";
import Link from "next/link";

import { AiPromoLoader } from "@/features/downloads/ai-promo-loader";
import { promoStages, type AiPromo } from "@/lib/ai/promo/config";
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
 * A server component: no image, no blur, no JavaScript, and (since 2026-10-09)
 * no animation at rest — see the note on the still field below.
 */
export function FrenzAICta({
  className,
  promo = null,
}: {
  className?: string;
  /**
   * The landing promotion (Brief C, lib/ai/promo/config.ts). When it has media,
   * a tiny loader plays it over this tile after the page has loaded. Absent or
   * empty, the tile is exactly what it was — plus the rotating tool name.
   */
  promo?: AiPromo | null;
}) {
  const playsMedia = !!promo && promoStages(promo).length > 1;
  return (
    <Link
      href="/ai"
      data-track="ai_clicked"
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
      /*
        🔴 AN INLINE minHeight, BECAUSE THE UTILITY CLASS IS INERT HERE.

        Owner, 2026-09-09: "the wallpaper and ai features button in the landing
        page is still shorter [than] the button in download page."

        The note above records the measurement: `min-h-[11rem]` is on this
        element, its rule is in the built CSS, the selector matches — and
        `getComputedStyle(tile).minHeight` is `0px` inside this grid. So every
        tile in that row has been sized by its CONTENT, and the landing tile is
        shorter for the honest reason that it holds less.

        An inline style is not a preference over the class; it is the one form
        of this rule that survives whatever is defeating the utility. All three
        tiles carry the identical value, so the row is the same height on both
        pages by construction rather than by whichever happens to have the most
        words in it.
      */
      style={{ minHeight: "11rem" }}
    >
      {/*
        ── 🔴 A STILL FIELD, NOT A MOVING ONE (Download page refinement,
        2026-10-09: "avoid large, continuously animated gradients … minimal
        CPU/GPU activity") ──────────────────────────────────────────────────
        This was three oversized radial gradients drifting on 13/17/23-second
        infinite loops (owner, 2026-09-08: "feels alive … just like gemini").
        Composited, but never idle: three tile-sized layers re-rasterised every
        frame for as long as the page was open, which is exactly the background
        work that warms a phone. The same blue, violet and white are now painted
        ONCE, where the moving blobs spent most of their time — the reference's
        soft lavender tile. Nothing on this tile runs at rest.
      */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 dark:hidden"
        style={{
          background:
            "radial-gradient(120% 90% at 0% 100%, rgba(66,133,244,0.18) 0%, transparent 60%), radial-gradient(110% 90% at 100% 0%, rgba(168,85,247,0.20) 0%, rgba(217,70,239,0.08) 45%, transparent 70%), linear-gradient(160deg, #f5f3ff 0%, #eef2ff 55%, #fdf4ff 100%)",
        }}
      />
      {/* The same wash for the dark theme: the hues at night strength on the dark tile. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 hidden dark:block"
        style={{
          background:
            "radial-gradient(120% 90% at 0% 100%, rgba(66,133,244,0.22) 0%, transparent 60%), radial-gradient(110% 90% at 100% 0%, rgba(168,85,247,0.26) 0%, rgba(217,70,239,0.10) 45%, transparent 70%)",
        }}
      />

      {/*
        The scrim. Static, painted once: it keeps the title and subtitle on a
        calm ground at the foot of the tile, and it is what the promotion's
        media fade in over.
      */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-white/85 via-white/35 to-transparent dark:from-[#0b1020]/85 dark:via-[#0b1020]/35"
      />

      {/*
        The wand on a solid brand disc (2026-10-09, the improved reference) —
        the Save button's own blue → violet, with a white rim and one soft
        shadow. It replaces a cyan-to-magenta conic "neon ring" whose translucent
        middle only made sense while the ambient field drifted through it.
      */}
      <span
        aria-hidden
        className="relative z-[1] flex h-[3.1rem] w-[3.1rem] shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 shadow-[0_8px_18px_-8px_rgba(79,70,229,0.75)] ring-4 ring-white/80 dark:ring-white/10"
      >
        <Wand2 className="h-[1.35rem] w-[1.35rem] text-white" />
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
          {/*
            One still line (Download page refinement, 2026-10-09, to the
            reference: "Create amazing videos with AI"). It was a CSS rotor
            cycling the five tool names every 3 s, forever — an animation that
            never stopped for a line most people read once. The tool names live
            on /ai, one tap away.
          */}
          <span className="mt-1 block text-xs leading-snug text-slate-500 dark:text-white/70">Create amazing videos with AI</span>
        </span>
        <span className="flex h-[2.6rem] w-[2.6rem] shrink-0 items-center justify-center rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200/80 transition group-hover:bg-slate-200 dark:bg-white/10 dark:ring-white/15">
          <ArrowRight className="h-[1.05rem] w-[1.05rem] text-slate-700 transition-transform group-hover:translate-x-0.5 dark:text-white" />
        </span>
      </span>
      {playsMedia ? <AiPromoLoader promo={promo!} /> : null}
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
          : /* The BAR: one row, y-padding 2 (owner, 2026-09-14: "is supposed to fit in and have a just y axis padding of 2"). */
            "flex w-full items-center gap-3 rounded-2xl px-4 py-2 shadow-[0_8px_24px_-8px_rgba(15,23,42,0.16)]",
        className,
      )}
      /*
        🔴 AN INLINE minHeight, BECAUSE THE UTILITY CLASS IS INERT HERE.

        Owner, 2026-09-09: "the wallpaper and ai features button in the landing
        page is still shorter [than] the button in download page."

        The note above records the measurement: `min-h-[11rem]` is on this
        element, its rule is in the built CSS, the selector matches — and
        `getComputedStyle(tile).minHeight` is `0px` inside this grid. So every
        tile in that row has been sized by its CONTENT, and the landing tile is
        shorter for the honest reason that it holds less.

        An inline style is not a preference over the class; it is the one form
        of this rule that survives whatever is defeating the utility. All three
        tiles carry the identical value, so the row is the same height on both
        pages by construction rather than by whichever happens to have the most
        words in it.
      */
      // 🔴 The TILE only. This applied to the bar too and made the full-width
      // "Explore Features" row eleven rem tall (owner, 2026-09-14 screenshot).
      style={tile ? { minHeight: "11rem" } : undefined}
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
